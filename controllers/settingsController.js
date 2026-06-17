const Settings = require('../models/Settings');
const StoreSettings = require('../models/StoreSettings');
const { createLog } = require('./auditController');

exports.getSettings = async (req, res) => {
    try {
        if (req.storeId) {
            const storeSettings = await StoreSettings.findOneAndUpdate({ storeId: req.storeId }, { $setOnInsert: { storeId: req.storeId } }, { upsert: true, new: true });
            return res.status(200).json({ success: true, data: { shipping: storeSettings.shippingSettings } });
        }
        let settings = await Settings.findOne();
        if (!settings) {
            settings = await Settings.create({});
        }
        res.status(200).json({ success: true, data: settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        if (req.storeId) {
            const payload = req.body.shipping || req.body;
            const storeSettings = await StoreSettings.findOneAndUpdate({ storeId: req.storeId }, { shippingSettings: payload }, { upsert: true, new: true });
            await createLog(req.user.id, 'shipping_update', 'Updated global shipping configuration', { storeId: req.storeId, entity: 'store_settings', entityId: storeSettings._id, req });
            return res.status(200).json({ success: true, data: { shipping: storeSettings.shippingSettings } });
        }
        let settings = await Settings.findOne();
        if (!settings) {
            settings = await Settings.create(req.body);
        } else {
            settings = await Settings.findOneAndUpdate({}, req.body, { new: true });
        }

        await createLog(req.user.id, 'Shipping Settings Update', 'Updated global shipping configuration');

        res.status(200).json({ success: true, data: settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
