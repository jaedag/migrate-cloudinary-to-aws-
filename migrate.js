require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const AWS = require('aws-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure AWS S3
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS_PER_BATCH) || 100;
const RESOURCE_TYPE = process.env.RESOURCE_TYPE || 'image';
const DELIVERY_TYPE = process.env.DELIVERY_TYPE || 'upload';

// Create downloads directory if it doesn't exist
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

class CloudinaryToS3Migrator {
  constructor(options = {}) {
    this.migratedCount = 0;
    this.failedCount = 0;
    this.skippedCount = 0;
    this.totalCount = 0;
    this.failedAssets = [];
    this.skippedAssets = [];
    this.skipExisting = options.skipExisting !== false; // Default to true
    this.forceOverwrite = options.forceOverwrite === true; // Default to false
  }

  async migrate() {
    console.log('🚀 Starting Cloudinary to S3 migration...');
    console.log(`Resource type: ${RESOURCE_TYPE}`);
    console.log(`Delivery type: ${DELIVERY_TYPE}`);
    console.log(`Batch size: ${MAX_RESULTS}`);
    console.log(`Skip existing files: ${this.skipExisting ? 'Yes' : 'No'}`);
    console.log(`Force overwrite: ${this.forceOverwrite ? 'Yes' : 'No'}`);
    console.log('---');

    let nextCursor = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const options = {
          resource_type: RESOURCE_TYPE,
          type: DELIVERY_TYPE,
          max_results: MAX_RESULTS,
          fields: 'public_id,format,resource_type,type,bytes,width,height,created_at,folder,tags,context'
        };

        if (nextCursor) {
          options.next_cursor = nextCursor;
        }

        console.log(`📥 Fetching resources from Cloudinary (cursor: ${nextCursor || 'start'})...`);
        
        const result = await cloudinary.api.resources(options);
        
        console.log(`Found ${result.resources.length} resources in this batch`);
        this.totalCount += result.resources.length;

        await this.processBatch(result.resources);

        if (result.next_cursor) {
          nextCursor = result.next_cursor;
        } else {
          hasMore = false;
        }

        // Progress update
        console.log(`Progress: ${this.migratedCount} migrated, ${this.skippedCount} skipped, ${this.failedCount} failed, ${this.totalCount} total processed`);
        console.log('---');

      } catch (error) {
        console.error('❌ Error fetching resources from Cloudinary:', error);
        break;
      }
    }

    this.printSummary();
  }

  async processBatch(resources) {
    // Use p-limit for controlled concurrency
    const pLimit = require('p-limit').default;
    const concurrency = parseInt(process.env.MIGRATION_CONCURRENCY) || 10; // Default to 10
    const limit = pLimit(concurrency);

    const tasks = resources.map(resource =>
      limit(() => this.migrateAsset(resource)
        .then(result => {
          if (result === 'migrated') this.migratedCount++;
          else if (result === 'skipped') this.skippedCount++;
        })
        .catch(error => {
          console.error(`❌ Failed to migrate ${resource.public_id}:`, error.message);
          this.failedCount++;
          this.failedAssets.push({
            public_id: resource.public_id,
            error: error.message
          });
        })
      )
    );
    await Promise.all(tasks);
  }

  async migrateAsset(resource) {
    const { public_id, format } = resource;
    // Always store under 'cloudinary/' and preserve full folder structure
    const s3Key = `cloudinary/${public_id}.${format}`;

    // Check if file already exists in S3 (unless force overwrite is enabled)
    if (this.skipExisting && !this.forceOverwrite) {
      const exists = await this.checkS3FileExists(s3Key);
      if (exists) {
        console.log(`⏭️  Skipping existing: ${public_id}.${format}`);
        this.skippedAssets.push({
          public_id,
          s3_key: s3Key,
          reason: 'already_exists'
        });
        return 'skipped';
      }
    }

    console.log(`📤 Migrating: ${public_id}.${format}`);

    // Use the direct secure_url from the resource object
    const cloudinaryUrl = resource.secure_url || resource.url;
    if (!cloudinaryUrl) {
      throw new Error(`No downloadable URL found for ${public_id}`);
    }

    // Download from Cloudinary
    const localFilePath = await this.downloadAsset(cloudinaryUrl, public_id, format);

    // Upload to S3
    await this.uploadToS3(localFilePath, resource, s3Key);

    // Clean up local file
    fs.unlinkSync(localFilePath);

    console.log(`✅ Migrated: ${public_id}.${format}`);
    return 'migrated';
  }

  async checkS3FileExists(s3Key) {
    try {
      await s3.headObject({
        Bucket: BUCKET_NAME,
        Key: s3Key
      }).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        return false;
      }
      // For other errors, we'll assume the file doesn't exist and try to upload
      console.warn(`⚠️  Warning: Could not check if ${s3Key} exists: ${error.message}`);
      return false;
    }
  }

  async downloadAsset(url, publicId, format) {
    const fileName = `${publicId.replace(/\//g, '_')}.${format}`;
    const filePath = path.join(downloadsDir, fileName);

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });
  }

  async uploadToS3(filePath, resource, s3KeyOverride) {
    const { public_id, format, resource_type, bytes, width, height, created_at, tags, context } = resource;
    // Use s3KeyOverride if provided, else fallback to old logic
    const s3Key = s3KeyOverride || `cloudinary/${public_id}.${format}`;
    const fileContent = fs.readFileSync(filePath);

    // Prepare metadata
    const metadata = {
      'original-public-id': public_id,
      'resource-type': resource_type,
      'cloudinary-created-at': created_at
    };

    if (bytes) metadata['original-size'] = bytes.toString();
    if (width) metadata.width = width.toString();
    if (height) metadata.height = height.toString();
    if (tags && tags.length > 0) metadata.tags = tags.join(',');

    // Add context metadata if available
    if (context) {
      Object.keys(context).forEach(key => {
        metadata[`context-${key}`] = context[key];
      });
    }

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      Metadata: metadata,
      ContentType: this.getContentType(format)
    };

    await s3.upload(uploadParams).promise();
  }

  getContentType(format) {
    const contentTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'pdf': 'application/pdf'
    };

    return contentTypes[format.toLowerCase()] || 'application/octet-stream';
  }

  printSummary() {
    console.log('\n🎉 Migration completed!');
    console.log('========================');
    console.log(`Total assets processed: ${this.totalCount}`);
    console.log(`Successfully migrated: ${this.migratedCount}`);
    console.log(`Skipped (already exist): ${this.skippedCount}`);
    console.log(`Failed: ${this.failedCount}`);

    if (this.skippedAssets.length > 0) {
      console.log('\n⏭️ Skipped assets (first 10):');
      this.skippedAssets.slice(0, 10).forEach(asset => {
        console.log(`  - ${asset.public_id}: ${asset.reason}`);
      });
      if (this.skippedAssets.length > 10) {
        console.log(`  ... and ${this.skippedAssets.length - 10} more`);
      }
      // Write skipped assets to file for review
      const skippedAssetsFile = path.join(__dirname, 'skipped-assets.json');
      fs.writeFileSync(skippedAssetsFile, JSON.stringify(this.skippedAssets, null, 2));
      console.log(`\nSkipped assets logged to: ${skippedAssetsFile}`);
      // Also write to a new file for retry
      const skippedMigrationsFile = path.join(__dirname, 'skipped-migrations.json');
      fs.writeFileSync(skippedMigrationsFile, JSON.stringify(this.skippedAssets, null, 2));
      console.log(`Skipped migrations for retry logged to: ${skippedMigrationsFile}`);
    }

    if (this.failedAssets.length > 0) {
      console.log('\n❌ Failed assets:');
      this.failedAssets.forEach(asset => {
        console.log(`  - ${asset.public_id}: ${asset.error}`);
      });
      // Write failed assets to file for review
      const failedAssetsFile = path.join(__dirname, 'failed-assets.json');
      fs.writeFileSync(failedAssetsFile, JSON.stringify(this.failedAssets, null, 2));
      console.log(`\nFailed assets logged to: ${failedAssetsFile}`);
    }

    console.log('\n✨ Migration summary complete!');
  }
}

// Main execution
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--skip-existing':
        options.skipExisting = true;
        break;
      case '--no-skip-existing':
        options.skipExisting = false;
        break;
      case '--force-overwrite':
        options.forceOverwrite = true;
        options.skipExisting = false; // Force overwrite implies no skipping
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  // Validate environment variables
  const requiredEnvVars = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET_NAME'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    console.error('\nPlease update your .env file and try again.');
    process.exit(1);
  }

  try {
    const migrator = new CloudinaryToS3Migrator(options);
    await migrator.migrate();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Cloudinary to S3 Migration Tool

Usage: node migrate.js [options]

Options:
  --skip-existing       Skip files that already exist in S3 (default)
  --no-skip-existing    Process all files, even if they exist in S3
  --force-overwrite     Force overwrite existing files in S3
  --help               Show this help message

Examples:
  # Default migration (skips existing files)
  node migrate.js

  # Force overwrite all files
  node migrate.js --force-overwrite

  # Process all files without checking existence
  node migrate.js --no-skip-existing

Environment Variables:
  All required environment variables should be set in your .env file.
  See .env.example for the complete list.
  `);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Migration interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Migration terminated');
  process.exit(0);
});

if (require.main === module) {
  main();
}

module.exports = CloudinaryToS3Migrator;
