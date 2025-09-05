require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const AWS = require('aws-sdk');

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

class MigrationVerifier {
  constructor() {
    this.verified = 0;
    this.missing = 0;
    this.missingAssets = [];
    this.sizeMismatches = [];
  }

  async verify(resourceType = 'image', deliveryType = 'upload', sampleSize = null) {
    console.log('🔍 Verifying migration...');
    console.log(`Resource type: ${resourceType}`);
    console.log(`Delivery type: ${deliveryType}`);
    if (sampleSize) {
      console.log(`Sample size: ${sampleSize}`);
    }
    console.log('---');

    let nextCursor = null;
    let hasMore = true;
    let processed = 0;

    while (hasMore && (!sampleSize || processed < sampleSize)) {
      try {
        const maxResults = sampleSize ? Math.min(100, sampleSize - processed) : 100;
        
        const options = {
          resource_type: resourceType,
          type: deliveryType,
          max_results: maxResults,
          fields: 'public_id,format,bytes,folder'
        };

        if (nextCursor) {
          options.next_cursor = nextCursor;
        }

        console.log(`📥 Fetching resources from Cloudinary...`);
        
        const result = await cloudinary.api.resources(options);
        
        console.log(`Verifying ${result.resources.length} resources...`);
        
        await this.verifyBatch(result.resources);
        
        processed += result.resources.length;

        if (result.next_cursor && (!sampleSize || processed < sampleSize)) {
          nextCursor = result.next_cursor;
        } else {
          hasMore = false;
        }

        console.log(`Progress: ${this.verified} verified, ${this.missing} missing, ${processed} total checked`);

      } catch (error) {
        console.error('❌ Error fetching resources from Cloudinary:', error);
        break;
      }
    }

    this.printVerificationReport();
  }

  async verifyBatch(resources) {
    const promises = resources.map(resource => this.verifyAsset(resource));
    await Promise.all(promises);
  }

  async verifyAsset(resource) {
    const { public_id, format, bytes, folder } = resource;
    
    try {
      // Construct S3 key (same logic as migration script)
      const s3Key = folder ? `${folder}/${public_id}.${format}` : `${public_id}.${format}`;
      
      // Check if object exists in S3
      const headParams = {
        Bucket: BUCKET_NAME,
        Key: s3Key
      };

      const s3Object = await s3.headObject(headParams).promise();
      
      // Verify size if available
      if (bytes && s3Object.ContentLength !== bytes) {
        this.sizeMismatches.push({
          public_id,
          cloudinary_size: bytes,
          s3_size: s3Object.ContentLength,
          s3_key: s3Key
        });
        console.log(`⚠️  Size mismatch: ${public_id} (Cloudinary: ${bytes}, S3: ${s3Object.ContentLength})`);
      }

      this.verified++;
      
    } catch (error) {
      if (error.code === 'NotFound') {
        this.missing++;
        this.missingAssets.push({
          public_id,
          format,
          expected_s3_key: folder ? `${folder}/${public_id}.${format}` : `${public_id}.${format}`
        });
        console.log(`❌ Missing: ${public_id}.${format}`);
      } else {
        console.error(`❌ Error checking ${public_id}:`, error.message);
      }
    }
  }

  printVerificationReport() {
    console.log('\n📊 Migration Verification Report');
    console.log('=================================');
    
    const total = this.verified + this.missing;
    const successRate = total > 0 ? ((this.verified / total) * 100).toFixed(2) : 0;
    
    console.log(`\n📈 Summary:`);
    console.log(`  Total Checked: ${total.toLocaleString()}`);
    console.log(`  Successfully Migrated: ${this.verified.toLocaleString()}`);
    console.log(`  Missing: ${this.missing.toLocaleString()}`);
    console.log(`  Success Rate: ${successRate}%`);
    
    if (this.sizeMismatches.length > 0) {
      console.log(`  Size Mismatches: ${this.sizeMismatches.length}`);
    }

    if (this.missing > 0) {
      console.log('\n❌ Missing Assets:');
      this.missingAssets.slice(0, 10).forEach(asset => {
        console.log(`  - ${asset.public_id}.${asset.format}`);
      });
      
      if (this.missingAssets.length > 10) {
        console.log(`  ... and ${this.missingAssets.length - 10} more`);
      }
    }

    if (this.sizeMismatches.length > 0) {
      console.log('\n⚠️ Size Mismatches:');
      this.sizeMismatches.slice(0, 5).forEach(asset => {
        console.log(`  - ${asset.public_id}: Cloudinary(${asset.cloudinary_size}) vs S3(${asset.s3_size})`);
      });
      
      if (this.sizeMismatches.length > 5) {
        console.log(`  ... and ${this.sizeMismatches.length - 5} more`);
      }
    }

    // Save detailed report
    if (this.missing > 0 || this.sizeMismatches.length > 0) {
      const reportData = {
        summary: {
          total_checked: total,
          verified: this.verified,
          missing: this.missing,
          success_rate: successRate,
          size_mismatches: this.sizeMismatches.length
        },
        missing_assets: this.missingAssets,
        size_mismatches: this.sizeMismatches,
        generated_at: new Date().toISOString()
      };

      const reportFile = `verification-report-${Date.now()}.json`;
      require('fs').writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
      console.log(`\n💾 Detailed report saved to: ${reportFile}`);
    }

    if (successRate == 100) {
      console.log('\n✅ Migration verification completed successfully!');
    } else {
      console.log('\n⚠️ Migration verification found issues. Check the report above.');
    }
  }
}

// CLI interface
async function runVerification() {
  const args = process.argv.slice(2);
  let resourceType = 'image';
  let deliveryType = 'upload';
  let sampleSize = null;

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--resource-type':
        resourceType = args[++i];
        break;
      case '--delivery-type':
        deliveryType = args[++i];
        break;
      case '--sample-size':
        sampleSize = parseInt(args[++i]);
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

  const verifier = new MigrationVerifier();
  await verifier.verify(resourceType, deliveryType, sampleSize);
}

function printHelp() {
  console.log(`
Migration Verification Tool

Usage: node verify.js [options]

Options:
  --resource-type <type>    Asset type to verify: image, video, raw (default: image)
  --delivery-type <type>    Delivery type to verify: upload, private, authenticated, etc. (default: upload)
  --sample-size <number>    Number of assets to verify (verifies all if not specified)
  --help                    Show this help message

Examples:
  # Verify all migrated images
  node verify.js

  # Verify first 100 migrated videos
  node verify.js --resource-type video --sample-size 100

  # Verify private images
  node verify.js --delivery-type private
  `);
}

if (require.main === module) {
  runVerification().catch(error => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });
}

module.exports = MigrationVerifier;
