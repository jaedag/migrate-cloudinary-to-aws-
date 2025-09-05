# How to Run Cloudinary to S3 Migration on EC2

This guide will help you set up and run the Cloudinary to S3 migration script on an Amazon EC2 instance.

## Prerequisites

1. **Launch an EC2 instance** (Amazon Linux 2 recommended)
2. **SSH into your EC2 instance**

## Step 1: Install Required Software

### Install Git
```bash
sudo yum install git -y
```

### Install Node.js and npm
```bash
sudo yum install nodejs -y
sudo yum install npm -y
```

### Install screen (for background processing)
```bash
sudo yum install screen -y
```

## Step 2: Clone and Setup the Project

### Clone the repository
```bash
git clone https://github.com/jaedag/migrate-cloudinary-to-aws-.git
cd migrate-cloudinary-to-aws-
```

### Install dependencies
```bash
npm install
```

### Setup environment variables
```bash
cp .env.example .env
nano .env
```

Fill in your credentials in the `.env` file:
```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_S3_BUCKET_NAME=your_bucket_name
SLACK_WEBHOOK_URL=your_slack_webhook_url
MAX_RESULTS_PER_BATCH=100
MIGRATION_CONCURRENCY=10
RESOURCE_TYPE=image
DELIVERY_TYPE=upload
```

Save and exit: Press `Ctrl+X`, then `Y`, then `Enter`

## Step 3: Run the Migration in Background

### Create a new screen session
```bash
screen -S migration
```

### Inside the screen session, run your script
```bash
node migrate.js
```

### Detach from screen (keeps running)
Press `Ctrl+A` then `D`

Your migration will continue running in the background even if you close your SSH connection.

## Step 4: Monitor Progress

### To reattach to the running session
```bash
screen -r migration
```

### To check if the session is still running
```bash
screen -ls
```

### To view migration logs (if you detached)
You can also check the console output by reattaching to the screen session.

## Step 5: Migration Options

### Default migration (skips existing files)
```bash
node migrate.js
```

### Force overwrite all files
```bash
node migrate.js --force-overwrite
```

### Process all files without checking existence
```bash
node migrate.js --no-skip-existing
```

## Monitoring and Notifications

- **Slack notifications**: After each batch completion (if webhook URL is configured)
- **Progress logs**: Real-time progress updates in the console
- **Output files**: 
  - `failed-assets.json` - List of failed migrations
  - `skipped-assets.json` - List of skipped files

## Useful Commands

### To terminate the migration
1. Reattach to screen: `screen -r migration`
2. Press `Ctrl+C` to stop the script
3. Detach: `Ctrl+A` then `D` or exit: `exit`

### To kill a screen session
```bash
screen -S migration -X quit
```

### To check system resources
```bash
top
htop  # if available
df -h  # disk space
```

## Troubleshooting

### If you get "screen: command not found"
```bash
sudo yum update
sudo yum install screen -y
```

### If Node.js version is too old
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install node
nvm use node
```

### If the migration stops unexpectedly
1. Check the screen session: `screen -r migration`
2. Review any error messages
3. Check the failed-assets.json file for specific errors
4. Restart the migration - it will skip already migrated files

## Security Notes

- Your `.env` file contains sensitive credentials - never commit it to version control
- Consider using IAM roles instead of access keys for enhanced security
- Monitor your AWS costs during migration
- Ensure your EC2 instance has sufficient disk space for temporary file downloads

## Estimated Time

Migration time depends on:
- Number of assets in Cloudinary
- File sizes
- Network speed
- Concurrency settings (MIGRATION_CONCURRENCY)

For large migrations (100k+ files), expect several hours to days