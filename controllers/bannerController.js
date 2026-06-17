const Banner = require('../models/Banner');
const { createLog } = require('./auditController');
const socketUtil = require('../utils/socket');
const storeFilter = (req, extra = {}) => req.storeId ? { ...extra, storeId: req.storeId } : extra;

exports.getBanners = async (req, res) => {
    try {
        const banners = await Banner.find(storeFilter(req));
        res.status(200).json({ success: true, data: banners });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.createBanner = async (req, res) => {
    try {
        delete req.body.storeId;
        const banner = await Banner.create({ ...req.body, ...(req.storeId && { storeId: req.storeId }) });
        await createLog(req.user.id, 'banner_create', `Added new hero banner: ${banner.title}`, { storeId: req.storeId, entity: 'banner', entityId: banner._id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('banner:updated', banner) : io.emit('banner:new', banner);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(201).json({ success: true, data: banner });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateBanner = async (req, res) => {
    try {
        delete req.body.storeId;
        const banner = await Banner.findOneAndUpdate(storeFilter(req, { _id: req.params.id }), req.body, { new: true });
        await createLog(req.user.id, 'banner_update', `Updated banner: ${banner.title}`, { storeId: req.storeId, entity: 'banner', entityId: banner._id, req });

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('banner:updated', banner) : io.emit('banner:update', banner);
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: banner });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.deleteBanner = async (req, res) => {
    try {
        await Banner.findOneAndDelete(storeFilter(req, { _id: req.params.id }));

        // Emit Socket Event
        try {
            const io = socketUtil.getIO();
            req.storeId ? io.to(`store:${req.storeId}`).emit('banner:updated', { id: req.params.id, delete: true }) : io.emit('banner:delete', { id: req.params.id });
        } catch (e) { console.error('Socket Emit Error:', e); }

        res.status(200).json({ success: true, data: {} });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
