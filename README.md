# Cloudinary to AWS S3 Migration

This project migrates assets from Cloudinary to AWS S3 bucket using the Cloudinary Admin API's `get_resources` endpoint. It's designed to run locally and handle large-scale migrations efficiently.

## Quick Start

1. **Run the setup script:**
   ```bash
   ./setup.sh
   ```

2. **Update your credentials in `.env`:**
   ```bash
   # Cloudinary Configuration
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret

   # AWS Configuration
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_access_key_id
   AWS_SECRET_ACCESS_KEY=your_secret_access_key
   AWS_S3_BUCKET_NAME=your_s3_bucket_name
   ```

3. **Analyze your assets (recommended first step):**
   ```bash
   npm run analyze
   ```

4. **Run the migration:**
   ```bash
   npm run migrate          # Skip existing files (default)
   npm run migrate:force    # Force overwrite existing files
   npm run migrate:all      # Process all files without checking existence
   ```

5. **Verify the migration:**
   ```bash
   npm run verify
   ```

## Features

### 🔍 **Analysis Tool** (`analyze.js`)
- Analyzes your Cloudinary assets before migration
- Provides detailed statistics and recommendations
- Estimates transfer time and identifies potential issues

### 🚀 **Full Migration** (`migrate.js`)
- Migrates all assets using the Cloudinary Admin API
- **Skips existing files by default** for efficient incremental migrations
- Handles pagination automatically
- Preserves folder structure and metadata
- Error handling and retry logic
- Progress tracking with detailed logs
- Configurable overwrite behavior

### 🎯 **Selective Migration** (`selective-migrate.js`)
- Migrate specific assets by public ID
- Filter by prefix, date range, or other criteria
- Perfect for incremental migrations

### ✅ **Verification Tool** (`verify.js`)
- Verifies migration completeness
- Compares file sizes between Cloudinary and S3
- Generates detailed reports for missing or mismatched assets

## Detailed Usage

### Analysis
```bash
# Analyze all images
npm run analyze

# Analyze videos
npm run analyze -- --resource-type video

# Analyze private assets
npm run analyze -- --delivery-type private
```

### Migration Options
```bash
# Default migration - skips existing files
npm run migrate

# Force overwrite all existing files
npm run migrate:force

# Process all files without checking if they exist
npm run migrate:all

# Command line options
node migrate.js --skip-existing      # Default behavior
node migrate.js --force-overwrite    # Overwrite existing files
node migrate.js --no-skip-existing   # Don't check for existing files

# Selective migration examples
npm run selective -- --prefix "products/"
npm run selective -- --public-ids "image1,image2,image3"
npm run selective -- --start-at "2024-01-01"
npm run selective -- --resource-type video --tags --context --skip-existing
```

### Verification
```bash
# Verify all migrated assets
npm run verify

# Verify a sample of 100 assets
npm run verify -- --sample-size 100

# Verify specific resource type
npm run verify -- --resource-type video
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name | ✅ |
| `CLOUDINARY_API_KEY` | Your Cloudinary API key | ✅ |
| `CLOUDINARY_API_SECRET` | Your Cloudinary API secret | ✅ |
| `AWS_REGION` | AWS region for S3 bucket | ✅ |
| `AWS_ACCESS_KEY_ID` | AWS access key ID | ✅ |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key | ✅ |
| `AWS_S3_BUCKET_NAME` | Target S3 bucket name | ✅ |
| `MAX_RESULTS_PER_BATCH` | Assets per API call (max 500) | ❌ (default: 100) |
| `RESOURCE_TYPE` | Asset type: image, video, raw | ❌ (default: image) |
| `DELIVERY_TYPE` | Delivery type: upload, private, etc. | ❌ (default: upload) |
| `SKIP_EXISTING` | Skip files that already exist in S3 | ❌ (default: true) |

### Cloudinary Admin API

This tool uses the Cloudinary Admin API's `get_resources` endpoint:

```javascript
cloudinary.v2.api.resources({
  resource_type: 'image',
  type: 'upload',
  max_results: 100,
  next_cursor: cursor,
  fields: 'public_id,format,resource_type,type,bytes,width,height,created_at,folder,tags,context'
})
```

**Key parameters used:**
- `resource_type`: Type of asset (image, video, raw)
- `type`: Delivery type (upload, private, authenticated, etc.)
- `max_results`: Number of results per request (up to 500)
- `next_cursor`: For pagination through large result sets
- `fields`: Specific fields to include in the response
- `prefix`: Filter by public ID prefix
- `start_at`: Filter by creation date

## Project Structure

```
migrate-cloudinary-to-aws/
├── migrate.js              # Main migration script
├── selective-migrate.js    # Selective migration with filters
├── analyze.js             # Asset analysis tool
├── verify.js              # Migration verification tool
├── setup.sh               # Automated setup script
├── package.json           # Node.js dependencies and scripts
├── .env.example           # Environment variables template
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## Output and Logs

### Generated Files
- `downloads/` - Temporary storage for assets during migration
- `cloudinary-analysis-*.json` - Detailed analysis reports
- `failed-assets.json` - List of assets that failed to migrate
- `verification-report-*.json` - Migration verification results

### Console Output
The tools provide detailed console output including:
- Progress tracking with counts and percentages
- Asset-by-asset migration status
- Error messages with specific details
- Summary reports with recommendations

## Error Handling

### Common Issues and Solutions

1. **Rate Limiting**
   - The scripts include built-in delays between requests
   - Reduce `MAX_RESULTS_PER_BATCH` if you encounter rate limits

2. **Large Files**
   - Script handles timeout errors with retry logic
   - Very large video files may need manual intervention

3. **Network Issues**
   - Built-in retry logic for temporary network problems
   - Failed assets are logged for retry

4. **Permission Errors**
   - Ensure AWS credentials have S3 write permissions
   - Verify Cloudinary API key has admin access

### Retry Failed Assets
If some assets fail during migration, you can retry them:

```bash
# The failed assets are saved to failed-assets.json
# Extract the public IDs and retry with selective migration
npm run selective -- --public-ids "failed_id_1,failed_id_2,failed_id_3"
```

## Skip Existing Files Feature

**By default, the migration tool skips files that already exist in S3**, making it safe to run multiple times and perfect for incremental migrations.

### How it works:
1. Before downloading from Cloudinary, the tool checks if the file already exists in S3
2. If the file exists, it skips the download and upload (saves time and bandwidth)
3. If the file doesn't exist, it proceeds with the normal migration
4. Skipped files are tracked and reported separately

### Behavior Options:
- **`--skip-existing`** (default): Skip files that already exist in S3
- **`--no-skip-existing`**: Process all files without checking existence
- **`--force-overwrite`**: Overwrite all existing files in S3

### Use Cases:
- **Incremental migrations**: Add new assets without re-uploading existing ones
- **Resume interrupted migrations**: Continue where you left off
- **Backup verification**: Ensure all assets are in S3 without duplicating work
- **Selective updates**: Use `--force-overwrite` only for specific assets that need updating

## Performance Optimization

### For Large Datasets
- Use the analysis tool first to understand your dataset
- Consider running migration during off-peak hours
- Monitor your AWS S3 request costs
- Use selective migration to process assets in batches

### Memory Usage
- The script processes assets in batches to manage memory
- Local downloads are cleaned up immediately after S3 upload
- For very large assets, ensure sufficient disk space

## Security Best Practices

1. **Environment Variables**
   - Never commit `.env` file to version control
   - Use IAM roles instead of access keys when possible
   - Rotate API keys regularly

2. **AWS Permissions**
   - Use minimal required S3 permissions
   - Consider using S3 bucket policies for additional security

3. **Cloudinary API**
   - Secure your API credentials
   - Monitor API usage in Cloudinary dashboard

## Troubleshooting

### Common Error Messages

- **"Missing required environment variables"**
  - Check your `.env` file has all required variables
  - Ensure `.env` file is in the project root

- **"Error fetching resources from Cloudinary"**
  - Verify Cloudinary credentials
  - Check internet connection
  - Verify API key has admin permissions

- **"S3 upload failed"**
  - Verify AWS credentials and permissions
  - Check S3 bucket exists and is accessible
  - Ensure sufficient S3 storage quota

### Getting Help
1. Check the console output for specific error messages
2. Review the generated log files
3. Use the verification tool to identify specific issues
4. Try selective migration for problematic assets

## Contributing

This tool is designed to be easily extensible:
- Add new migration filters in `selective-migrate.js`
- Extend analysis metrics in `analyze.js`
- Add new verification checks in `verify.js`

## License

ISC License - see package.json for details.
