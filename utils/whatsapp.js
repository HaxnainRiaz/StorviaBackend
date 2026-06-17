const twilio = require('twilio');

const sendWhatsAppNotification = async (to, message) => {
    try {
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_NUMBER) {
            console.warn('Twilio credentials missing. customized WhatsApp notification skipped.');
            console.log(`[MOCK WhatsApp to ${to}]: ${message}`);
            return;
        }

        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        const from = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
        // Ensure 'to' number has 'whatsapp:' prefix if not present, but usually stored as just number
        // The Twilio API expects 'whatsapp:+1234567890'
        const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

        const response = await client.messages.create({
            body: message,
            from: from,
            to: formattedTo
        });

        console.log(`WhatsApp notification sent to ${to}: ${response.sid}`);
        return response;
    } catch (error) {
        console.error('Error sending WhatsApp notification:', error.message);
        // Don't throw, just log so order process isn't interrupted
    }
};

module.exports = sendWhatsAppNotification;
