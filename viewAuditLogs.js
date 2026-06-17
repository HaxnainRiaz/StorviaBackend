const auditLogger = require('./utils/auditLogger');

/**
 * 📊 AUDIT LOG VIEWER
 * 
 * View and analyze audit logs
 * Usage: node viewAuditLogs.js [days]
 */

const viewAuditLogs = () => {
    const days = parseInt(process.argv[2]) || 7;

    console.log('\n========================================');
    console.log('📊 AUDIT LOG VIEWER');
    console.log('========================================\n');

    // Get recent logs
    const logs = auditLogger.getRecentLogs(days);

    if (logs.length === 0) {
        console.log(`No audit logs found for the last ${days} days.`);
        console.log('');
        process.exit(0);
    }

    // Generate report
    const report = auditLogger.generateReport(days);

    console.log(`📅 Period: ${report.period}`);
    console.log(`📝 Total Operations: ${report.totalOperations}`);
    console.log('');

    // Operations by type
    console.log('📋 Operations by Type:');
    Object.entries(report.byAction).forEach(([action, count]) => {
        const emoji = action.includes('BACKUP') ? '💾' :
            action.includes('RESTORE') ? '🔄' :
                action.includes('RESET') ? '🗑️' :
                    action.includes('SEED') ? '🌱' : '📌';
        console.log(`   ${emoji} ${action}: ${count}`);
    });
    console.log('');

    // Operations by status
    console.log('✅ Operations by Status:');
    Object.entries(report.byStatus).forEach(([status, count]) => {
        const emoji = status === 'SUCCESS' ? '✅' :
            status === 'ERROR' ? '❌' : '⚠️';
        console.log(`   ${emoji} ${status}: ${count}`);
    });
    console.log('');

    // Recent activity timeline
    console.log('⏰ Recent Activity (Last 10):');
    report.timeline.slice(0, 10).forEach(entry => {
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString();
        const emoji = entry.status === 'SUCCESS' ? '✅' :
            entry.status === 'ERROR' ? '❌' : '⚠️';
        console.log(`   ${emoji} ${timeStr} - ${entry.action}`);
    });
    console.log('');

    // Detailed logs
    if (process.argv.includes('--detailed')) {
        console.log('📄 Detailed Logs:');
        console.log('========================================');
        logs.slice(0, 20).forEach(log => {
            console.log(JSON.stringify(log, null, 2));
            console.log('----------------------------------------');
        });
    } else {
        console.log('💡 Tip: Add --detailed flag to see full log entries');
        console.log('   Example: node viewAuditLogs.js 7 --detailed');
    }
    console.log('');

    process.exit(0);
};

viewAuditLogs();
