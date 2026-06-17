const fs = require('fs');
const path = require('path');

/**
 * 🔍 AUDIT LOGGING SYSTEM
 * 
 * Tracks all critical database operations for security and compliance
 * Logs are stored in: backend/logs/audit/
 */

class AuditLogger {
    constructor() {
        this.logsDir = path.join(__dirname, 'logs', 'audit');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    getCurrentLogFile() {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.logsDir, `audit-${date}.log`);
    }

    formatLogEntry(action, details, status = 'SUCCESS') {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            action,
            status,
            details,
            user: process.env.USER || process.env.USERNAME || 'system',
            hostname: require('os').hostname()
        };
        return JSON.stringify(entry);
    }

    log(action, details, status = 'SUCCESS') {
        const logFile = this.getCurrentLogFile();
        const logEntry = this.formatLogEntry(action, details, status);

        try {
            fs.appendFileSync(logFile, logEntry + '\n');

            // Also log to console in development
            if (process.env.NODE_ENV !== 'production') {
                const emoji = status === 'SUCCESS' ? '✅' : status === 'ERROR' ? '❌' : '⚠️';
                console.log(`${emoji} AUDIT: ${action} - ${status}`);
            }
        } catch (err) {
            console.error('Failed to write audit log:', err.message);
        }
    }

    // Specific audit methods
    logBackup(filename, counts) {
        this.log('DATABASE_BACKUP', {
            operation: 'backup',
            filename,
            collections: counts,
            totalRecords: Object.values(counts).reduce((a, b) => a + b, 0)
        });
    }

    logRestore(filename, counts) {
        this.log('DATABASE_RESTORE', {
            operation: 'restore',
            filename,
            collections: counts,
            totalRecords: Object.values(counts).reduce((a, b) => a + b, 0)
        }, 'WARNING');
    }

    logReset(counts) {
        this.log('DATABASE_RESET', {
            operation: 'reset',
            deletedCollections: counts,
            totalDeleted: Object.values(counts).reduce((a, b) => a + b, 0)
        }, 'WARNING');
    }

    logSeed(type, count) {
        this.log('DATABASE_SEED', {
            operation: 'seed',
            type,
            recordsAdded: count
        });
    }

    logError(action, error) {
        this.log(action, {
            error: error.message,
            stack: error.stack
        }, 'ERROR');
    }

    // Read audit logs
    getLogsForDate(date) {
        const logFile = path.join(this.logsDir, `audit-${date}.log`);
        if (!fs.existsSync(logFile)) {
            return [];
        }

        const content = fs.readFileSync(logFile, 'utf8');
        return content.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
    }

    getRecentLogs(days = 7) {
        const logs = [];
        const now = new Date();

        for (let i = 0; i < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            const dayLogs = this.getLogsForDate(dateStr);
            logs.push(...dayLogs);
        }

        return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    generateReport(days = 7) {
        const logs = this.getRecentLogs(days);

        const report = {
            period: `Last ${days} days`,
            totalOperations: logs.length,
            byAction: {},
            byStatus: {},
            timeline: []
        };

        logs.forEach(log => {
            // Count by action
            report.byAction[log.action] = (report.byAction[log.action] || 0) + 1;

            // Count by status
            report.byStatus[log.status] = (report.byStatus[log.status] || 0) + 1;

            // Add to timeline
            report.timeline.push({
                timestamp: log.timestamp,
                action: log.action,
                status: log.status
            });
        });

        return report;
    }
}

// Export singleton instance
module.exports = new AuditLogger();
