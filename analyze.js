require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

class CloudinaryAnalyzer {
  constructor() {
    this.analysis = {
      totalAssets: 0,
      resourceTypes: {},
      deliveryTypes: {},
      formats: {},
      folders: {},
      totalSize: 0,
      avgSize: 0,
      largestAsset: null,
      smallestAsset: null,
      createdAtRange: {
        earliest: null,
        latest: null
      },
      tags: new Set(),
      contextKeys: new Set()
    };
  }

  async analyze(resourceType = 'image', deliveryType = 'upload') {
    console.log(`🔍 Analyzing Cloudinary assets (${resourceType}/${deliveryType})...`);
    console.log('---');

    let nextCursor = null;
    let hasMore = true;
    let batchCount = 0;

    while (hasMore) {
      try {
        const options = {
          resource_type: resourceType,
          type: deliveryType,
          max_results: 500, // Maximum allowed
          fields: 'public_id,format,resource_type,type,bytes,width,height,created_at,folder,tags,context'
        };

        if (nextCursor) {
          options.next_cursor = nextCursor;
        }

        console.log(`📥 Fetching batch ${++batchCount} (cursor: ${nextCursor || 'start'})...`);
        
        const result = await cloudinary.api.resources(options);
        
        console.log(`Processing ${result.resources.length} resources...`);
        this.processBatch(result.resources);

        if (result.next_cursor) {
          nextCursor = result.next_cursor;
        } else {
          hasMore = false;
        }

        console.log(`Processed: ${this.analysis.totalAssets} assets so far`);

      } catch (error) {
        console.error('❌ Error fetching resources from Cloudinary:', error);
        break;
      }
    }

    this.finalizeAnalysis();
    this.printReport();
    this.saveReport();
  }

  processBatch(resources) {
    resources.forEach(resource => {
      this.analyzeResource(resource);
    });
  }

  analyzeResource(resource) {
    const { 
      public_id, 
      format, 
      resource_type, 
      type, 
      bytes, 
      width, 
      height, 
      created_at, 
      folder, 
      tags, 
      context 
    } = resource;

    this.analysis.totalAssets++;

    // Resource types
    this.analysis.resourceTypes[resource_type] = 
      (this.analysis.resourceTypes[resource_type] || 0) + 1;

    // Delivery types
    this.analysis.deliveryTypes[type] = 
      (this.analysis.deliveryTypes[type] || 0) + 1;

    // Formats
    this.analysis.formats[format] = 
      (this.analysis.formats[format] || 0) + 1;

    // Folders
    if (folder) {
      this.analysis.folders[folder] = 
        (this.analysis.folders[folder] || 0) + 1;
    }

    // Size analysis
    if (bytes) {
      this.analysis.totalSize += bytes;

      if (!this.analysis.largestAsset || bytes > this.analysis.largestAsset.bytes) {
        this.analysis.largestAsset = { public_id, bytes, format };
      }

      if (!this.analysis.smallestAsset || bytes < this.analysis.smallestAsset.bytes) {
        this.analysis.smallestAsset = { public_id, bytes, format };
      }
    }

    // Date range
    if (created_at) {
      const createdDate = new Date(created_at);
      
      if (!this.analysis.createdAtRange.earliest || createdDate < this.analysis.createdAtRange.earliest) {
        this.analysis.createdAtRange.earliest = createdDate;
      }

      if (!this.analysis.createdAtRange.latest || createdDate > this.analysis.createdAtRange.latest) {
        this.analysis.createdAtRange.latest = createdDate;
      }
    }

    // Tags
    if (tags && Array.isArray(tags)) {
      tags.forEach(tag => this.analysis.tags.add(tag));
    }

    // Context keys
    if (context && typeof context === 'object') {
      Object.keys(context).forEach(key => this.analysis.contextKeys.add(key));
    }
  }

  finalizeAnalysis() {
    if (this.analysis.totalAssets > 0 && this.analysis.totalSize > 0) {
      this.analysis.avgSize = this.analysis.totalSize / this.analysis.totalAssets;
    }
  }

  printReport() {
    console.log('\n📊 Cloudinary Analysis Report');
    console.log('================================');
    
    console.log(`\n📈 Overview:`);
    console.log(`  Total Assets: ${this.analysis.totalAssets.toLocaleString()}`);
    console.log(`  Total Size: ${this.formatBytes(this.analysis.totalSize)}`);
    console.log(`  Average Size: ${this.formatBytes(this.analysis.avgSize)}`);

    if (this.analysis.largestAsset) {
      console.log(`  Largest Asset: ${this.analysis.largestAsset.public_id} (${this.formatBytes(this.analysis.largestAsset.bytes)})`);
    }

    if (this.analysis.smallestAsset) {
      console.log(`  Smallest Asset: ${this.analysis.smallestAsset.public_id} (${this.formatBytes(this.analysis.smallestAsset.bytes)})`);
    }

    console.log(`\n📅 Date Range:`);
    if (this.analysis.createdAtRange.earliest && this.analysis.createdAtRange.latest) {
      console.log(`  Earliest: ${this.analysis.createdAtRange.earliest.toISOString().split('T')[0]}`);
      console.log(`  Latest: ${this.analysis.createdAtRange.latest.toISOString().split('T')[0]}`);
    }

    console.log(`\n🗂️ Resource Types:`);
    Object.entries(this.analysis.resourceTypes)
      .sort(([,a], [,b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count.toLocaleString()}`);
      });

    console.log(`\n📦 Delivery Types:`);
    Object.entries(this.analysis.deliveryTypes)
      .sort(([,a], [,b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count.toLocaleString()}`);
      });

    console.log(`\n🎨 Formats:`);
    Object.entries(this.analysis.formats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10) // Top 10 formats
      .forEach(([format, count]) => {
        console.log(`  ${format}: ${count.toLocaleString()}`);
      });

    if (Object.keys(this.analysis.folders).length > 0) {
      console.log(`\n📁 Top Folders:`);
      Object.entries(this.analysis.folders)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10) // Top 10 folders
        .forEach(([folder, count]) => {
          console.log(`  ${folder}: ${count.toLocaleString()}`);
        });
    }

    if (this.analysis.tags.size > 0) {
      console.log(`\n🏷️ Tags Found: ${this.analysis.tags.size} unique tags`);
      if (this.analysis.tags.size <= 20) {
        console.log(`  Tags: ${Array.from(this.analysis.tags).join(', ')}`);
      }
    }

    if (this.analysis.contextKeys.size > 0) {
      console.log(`\n🔑 Context Keys: ${Array.from(this.analysis.contextKeys).join(', ')}`);
    }

    console.log('\n💡 Migration Recommendations:');
    this.printRecommendations();
  }

  printRecommendations() {
    const totalSizeGB = this.analysis.totalSize / (1024 * 1024 * 1024);
    
    if (totalSizeGB > 10) {
      console.log(`  ⚠️  Large dataset (${this.formatBytes(this.analysis.totalSize)}). Consider batch migration.`);
    }

    if (this.analysis.totalAssets > 10000) {
      console.log(`  ⚠️  Many assets (${this.analysis.totalAssets.toLocaleString()}). Use pagination and error handling.`);
    }

    const folderCount = Object.keys(this.analysis.folders).length;
    if (folderCount > 100) {
      console.log(`  📁 Many folders (${folderCount}). Consider preserving folder structure in S3.`);
    }

    if (this.analysis.tags.size > 0) {
      console.log(`  🏷️  Tags detected. Consider preserving as S3 object metadata.`);
    }

    if (this.analysis.contextKeys.size > 0) {
      console.log(`  🔑 Context metadata detected. Consider preserving as S3 object metadata.`);
    }

    const videoCount = this.analysis.resourceTypes.video || 0;
    if (videoCount > 0) {
      console.log(`  🎥 Video assets detected (${videoCount}). These may take longer to transfer.`);
    }

    console.log(`  📊 Estimated transfer time: ${this.estimateTransferTime()}`);
  }

  estimateTransferTime() {
    // Rough estimate based on 10MB/s average transfer speed
    const transferSpeedMBps = 10;
    const totalMB = this.analysis.totalSize / (1024 * 1024);
    const estimatedSeconds = totalMB / transferSpeedMBps;

    if (estimatedSeconds < 60) {
      return `${Math.ceil(estimatedSeconds)} seconds`;
    } else if (estimatedSeconds < 3600) {
      return `${Math.ceil(estimatedSeconds / 60)} minutes`;
    } else {
      return `${Math.ceil(estimatedSeconds / 3600)} hours`;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  saveReport() {
    const reportData = {
      ...this.analysis,
      tags: Array.from(this.analysis.tags),
      contextKeys: Array.from(this.analysis.contextKeys),
      generatedAt: new Date().toISOString()
    };

    const reportFile = path.join(__dirname, `cloudinary-analysis-${Date.now()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
    
    console.log(`\n💾 Detailed report saved to: ${reportFile}`);
  }
}

// CLI interface
async function runAnalysis() {
  const args = process.argv.slice(2);
  let resourceType = 'image';
  let deliveryType = 'upload';

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
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  // Validate environment variables
  const requiredEnvVars = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required Cloudinary environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    console.error('\nPlease update your .env file and try again.');
    process.exit(1);
  }

  const analyzer = new CloudinaryAnalyzer();
  await analyzer.analyze(resourceType, deliveryType);
}

function printHelp() {
  console.log(`
Cloudinary Asset Analyzer

Usage: node analyze.js [options]

Options:
  --resource-type <type>    Asset type to analyze: image, video, raw (default: image)
  --delivery-type <type>    Delivery type to analyze: upload, private, authenticated, etc. (default: upload)
  --help                    Show this help message

Examples:
  # Analyze all images
  node analyze.js

  # Analyze videos
  node analyze.js --resource-type video

  # Analyze private images
  node analyze.js --delivery-type private
  `);
}

if (require.main === module) {
  runAnalysis().catch(error => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  });
}

module.exports = CloudinaryAnalyzer;
