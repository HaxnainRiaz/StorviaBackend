const StoreMember = require('../models/StoreMember');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendPushNotification } = require('../utils/firebase');

const createStoreNotification = async ({ storeId, type, title, body = '', payload = {}, permissions = [] }) => {
    if (!storeId || !type || !title) return [];

    const members = await StoreMember.find({ storeId, status: 'active' }).lean();
    if (!members.length) return [];

    const allowedMembers = permissions.length
        ? members.filter(member => member.role === 'owner' || permissions.some(permission => (member.permissions || []).includes(permission)))
        : members;

    const userIds = allowedMembers.map(member => member.userId).filter(Boolean);
    if (!userIds.length) return [];

    const notifications = await Notification.insertMany(userIds.map(userId => ({
        storeId,
        userId,
        type,
        title,
        body,
        payload
    })));

    try {
        const users = await User.find({ _id: { $in: userIds } }).select('fcmTokens').lean();
        const tokens = users.flatMap(user => user.fcmTokens || []);
        if (tokens.length) {
            await sendPushNotification(tokens, {
                title,
                body,
                data: Object.fromEntries(Object.entries(payload || {}).map(([key, value]) => [key, String(value)]))
            });
        }
    } catch (error) {
        console.error('[Store Notification Push Error]:', error.message);
    }

    return notifications;
};

module.exports = { createStoreNotification };
