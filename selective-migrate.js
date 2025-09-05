require('dotenv').config();
const CloudinaryToS3Migrator = require('./migrate');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

class SelectiveMigrator extends CloudinaryToS3Migrator {
  constructor(options = {}) {
    super(options);
    this.options = {
      prefix: options.prefix || null,
      publicIds: options.publicIds || null,
      startAt: options.startAt || null,
      tags: options.tags || false,
      context: options.context || false,
      metadata: options.metadata || false,
      ...options
    };
  }

  async migrate() {
    console.log('🚀 Starting selective Cloudinary to S3 migration...');
    console.log('Options:', this.options);
    console.log('---');

    if (this.options.publicIds && this.options.publicIds.length > 0) {
      await this.migrateByPublicIds(this.options.publicIds);
    } else {
      await this.migrateWithFilters();
    }

    this.printSummary();
  }

  async migrateByPublicIds(publicIds) {
    console.log(`📥 Migrating ${publicIds.length} specific assets...`);
    
    // Split into batches of 100 (API limit)
    const batches = [];
    for (let i = 0; i < publicIds.length; i += 100) {
      batches.push(publicIds.slice(i, i + 100));
    }

    for (const batch of batches) {
      try {
        const result = await cloudinary.api.resources_by_ids(batch, {
          resource_type: this.options.resourceType || 'image',
          fields: 'public_id,format,resource_type,type,bytes,width,height,created_at,folder,tags,context'
        });

        console.log(`Found ${result.resources.length} resources in batch`);
        this.totalCount += result.resources.length;
        await this.processBatch(result.resources);

      } catch (error) {
        console.error('❌ Error fetching resources by IDs:', error);
      }
    }
  }

  async migrateWithFilters() {
    let nextCursor = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const options = {
          resource_type: this.options.resourceType || 'image',
          type: this.options.deliveryType || 'upload',
          max_results: this.options.maxResults || 100,
          fields: 'public_id,format,resource_type,type,bytes,width,height,created_at,folder,tags,context'
        };

        // Add optional filters
        if (this.options.prefix) options.prefix = this.options.prefix;
        if (this.options.startAt) options.start_at = this.options.startAt;
        if (this.options.tags) options.tags = true;
        if (this.options.context) options.context = true;
        if (this.options.metadata) options.metadata = true;

        if (nextCursor) {
          options.next_cursor = nextCursor;
        }

        console.log(`📥 Fetching resources with filters (cursor: ${nextCursor || 'start'})...`);
        
        const result = await cloudinary.api.resources(options);
        
        console.log(`Found ${result.resources.length} resources in this batch`);
        this.totalCount += result.resources.length;

        await this.processBatch(result.resources);

        if (result.next_cursor) {
          nextCursor = result.next_cursor;
        } else {
          hasMore = false;
        }

        console.log(`Progress: ${this.migratedCount} migrated, ${this.skippedCount} skipped, ${this.failedCount} failed, ${this.totalCount} total processed`);
        console.log('---');

      } catch (error) {
        console.error('❌ Error fetching resources from Cloudinary:', error);
        break;
      }
    }
  }
}

// CLI interface
async function runCLI() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--prefix':
        options.prefix = args[++i];
        break;
      case '--public-ids':
        options.publicIds = args[++i].split(',');
        break;
      case '--start-at':
        options.startAt = args[++i];
        break;
      case '--resource-type':
        options.resourceType = args[++i];
        break;
      case '--delivery-type':
        options.deliveryType = args[++i];
        break;
      case '--max-results':
        options.maxResults = parseInt(args[++i]);
        break;
      case '--tags':
        options.tags = true;
        break;
      case '--context':
        options.context = true;
        break;
      case '--metadata':
        options.metadata = true;
        break;
      case '--skip-existing':
        options.skipExisting = true;
        break;
      case '--no-skip-existing':
        options.skipExisting = false;
        break;
      case '--force-overwrite':
        options.forceOverwrite = true;
        options.skipExisting = false;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  const migrator = new SelectiveMigrator(options);
  await migrator.migrate();
}

function printHelp() {
  console.log(`
Cloudinary to S3 Selective Migration Tool

Usage: node selective-migrate.js [options]

Options:
  --prefix <prefix>           Migrate assets with public IDs starting with prefix
  --public-ids <ids>          Comma-separated list of specific public IDs to migrate
  --start-at <date>           Migrate assets created since date (ISO 8601 format)
  --resource-type <type>      Asset type: image, video, raw (default: image)
  --delivery-type <type>      Delivery type: upload, private, authenticated, etc. (default: upload)
  --max-results <number>      Max results per batch (default: 100, max: 500)
  --tags                      Include tag information
  --context                   Include context metadata
  --metadata                  Include structured metadata
  --skip-existing             Skip files that already exist in S3 (default)
  --no-skip-existing          Process all files, even if they exist in S3
  --force-overwrite           Force overwrite existing files in S3
  --help                      Show this help message

Examples:
  # Migrate all images with prefix "products/"
  node selective-migrate.js --prefix "products/"

  # Migrate specific assets
  node selective-migrate.js --public-ids "image1,image2,image3"

  # Migrate all assets created since 2024-01-01
  node selective-migrate.js --start-at "2024-01-01"

  # Migrate videos with tags and context
  node selective-migrate.js --resource-type video --tags --context
  `);
}

if (require.main === module) {
  runCLI().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = SelectiveMigrator;
