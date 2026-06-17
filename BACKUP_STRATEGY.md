# Production Backup & Recovery Strategy

## 1. Primary Mechanism: MongoDB Atlas Automated Backups
The most reliable way to protect production data is using the built-in capabilities of MongoDB Atlas.

### Configuration Steps:
1.  **Login to MongoDB Atlas Dashboard.**
2.  Navigate to **Database Deployments**.
3.  Select your Cluster -> **Backup** tab.
4.  **Enable Cloud Backup**: Ensure it is set to "On".
5.  **Retention Policy**: 
    - Set Daily snapshots to be kept for at least **7 days**.
    - Set Weekly snapshots for at least **4 weeks**.
    - Set Monthly snapshots for **1 year**.

## 2. Secondary Mechanism: External JSON Exports (Cloud Storage)
As a safety measure against Atlas-level issues, we implement a script to export the entire database to JSON.

### Automated Backup Script
The file `backupDatabase.js` has been optimized to generate full JSON snapshots.

### Implementation Guide (GitHub Actions):
To run this automatically every day, create `.github/workflows/db-backup.yml`:
```yaml
name: Daily DB Backup
on:
  schedule:
    - cron: '0 0 * * *' # Every night at midnight
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Backup
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
        run: |
          npm install
          node backupDatabase.js
      - name: Upload to S3/Cloud
        run: # Use aws-cli or similar to move the ./backups/ folder to safe storage
```

## 3. Disaster Recovery Procedure (Step-by-Step)

### Scenario A: Accidental Data Deletion (Minor)
If a few records were deleted:
1.  Locate the latest backup file in your cloud storage.
2.  Download the JSON file to your local machine.
3.  Run the restore utility:
    ```bash
    node restoreDatabase.js <filename.json>
    ```

### Scenario B: Full Database Corruption (Major)
If the entire database is corrupted or unreachable:
1.  **Stop the Backend**: Turn off the Vercel deployment if possible to prevent further issues.
2.  **Atlas Restore**:
    - Go to Atlas Dashboard -> **Backup** -> **Restore**.
    - Select "Find and Restore to a Point in Time" or "Select a Snapshot".
    - Choose a point just before the corruption occurred.
    - Click **Restore**.
3.  **Verification**:
    - Once Atlas completes the restore, verify the data via Atlas Compass.
    - Redeploy the backend.

### Scenario C: Total Service Loss
If MongoDB Atlas is completely down:
1.  Provision a new MongoDB Cluster (on a different provider or local).
2.  Update the `MONGODB_URI` in Vercel.
3.  Run the `restoreDatabase.js` utility using your latest **Secondary Backup (JSON)**.

---
**Recommendation:** Perform a "Restoration Drill" once every 3 months to ensure the secondary backup files are valid and the team knows how to use them.
