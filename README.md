# DynamoDB Clerk

Backup and Restore DynamoDB Tables

## CLI arguments

```bash
--access-key-id                   # AWS Access Key Id
--action                          # What action to perform. One of "backup-from-remote", "backup-from-local", "restore-to-remote", "restore-to-local"
--archive                         # Archive Name (local.tgz)
--archive-tables-search-pattern   # Use "(.+)" RegExp for everything
--db-tables-replace-pattern       # Use '\$1' RegExp for everything
--force                           # Force backup even if a local backup exists
--port                            # Local DynamoDB instance port
--profile                         # Profile name from AWS local credentials
--region                          # AWS region
--secret-access-key               # AWS Secret Access Key
--tables                          # Use "*" to skip the list and archive all tables
```

## Examples

```bash
npx dynamodb-clerk --action "restore-to-local" --port 8889 --access-key-id localAwsAccessKeyId --secret-access-key localAwsSecretAccessKey --archive backup.tgz --archive-tables-search-pattern "(.+)" --db-tables-replace-pattern '\$1'
```

```bash
npx dynamodb-clerk --action "backup-from-remote" --profile profile-name --tables "*" --force
```
