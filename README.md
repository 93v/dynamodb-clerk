# DynamoDB Clerk

Backup and Restore DynamoDB Tables

## CLI arguments

```bash
--action  # What action to perform. One of "backup-from-remote", "backup-from-local", "restore-to-remote", "restore-to-local"
--profile # Profile name from AWS local credentials
--region  # AWS region
--port    # Local DynamoDB instance port
--force   # Force backup even if a local backup exists
--tables  # List of tables to backup
```
