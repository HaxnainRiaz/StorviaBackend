const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');

let firebaseApp;

if (fs.existsSync(serviceAccountPath)) {
    try {
        const serviceAccount = require(serviceAccountPath);
        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase Admin SDK Initialized');
    } catch (error) {
        console.error('❌ Firebase Initialization Error:', error.message);
    }
} else {
    console.warn('⚠️ Firebase service account file not found. Notifications will not be sent.');
}

/**
 * Send push notification to multiple tokens
 * @param {string[]} tokens - Array of FCM registration tokens
 * @param {Object} payload - Notification payload { title, body, data }
 */
const sendPushNotification = async (tokens, payload) => {
    if (!firebaseApp) {
        console.warn('Firebase not initialized. Skipping notification.');
        return;
    }

    if (!tokens || tokens.length === 0) {
        console.warn('No tokens provided for notification');
        return;
    }

    // Filter out empty or null tokens and de-duplicate
    const validTokens = [...new Set(tokens.filter(token => token && typeof token === 'string'))];

    if (validTokens.length === 0) {
        console.warn('No valid tokens after filtering');
        return;
    }

    console.log(`📡 Attempting to send notification to ${validTokens.length} tokens...`);
    console.log(`Payload: ${JSON.stringify(payload)}`);

    // Determine priority based on notification type
    const notificationType = payload.data?.type || 'DEFAULT';
    const isHighPriority = notificationType === 'NEW_ORDER';

    const message = {
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: {
            ...payload.data,
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
            priority: isHighPriority ? 'high' : 'normal',
            notification: {
                channelId: 'high_importance_channel',
                priority: isHighPriority ? 'max' : 'default',
                defaultSound: true,
                defaultVibrateTimings: true,
                defaultLightSettings: true,
                notificationCount: 1,
            },
        },
        apns: {
            payload: {
                aps: {
                    alert: {
                        title: payload.title,
                        body: payload.body,
                    },
                    sound: 'default',
                    badge: 1,
                },
            },
            headers: {
                'apns-priority': isHighPriority ? '10' : '5',
            },
        },
        tokens: validTokens,
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`🚀 Sent ${response.successCount}/${validTokens.length} notifications successfully.`);

        if (response.failureCount > 0) {
            console.warn(`❌ Failed to send ${response.failureCount} notifications.`);
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.error(`Token ${idx} (${validTokens[idx].substring(0, 20)}...) Error:`, resp.error?.message || resp.error);
                }
            });
        }
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
};

module.exports = { sendPushNotification };
