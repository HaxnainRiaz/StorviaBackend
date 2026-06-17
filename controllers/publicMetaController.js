const MetaIntegration = require('../models/MetaIntegration');

exports.getMetaConfig = async (req, res) => {
    try {
        if (!req.storeId) {
            return res.status(410).json({
                success: false,
                message: 'Meta config is store-scoped. Use /api/storefront/:storeSlug/meta/pixel-config or /api/store/meta/:storeSlug/config.'
            });
        }

        const integration = await MetaIntegration.findOne({ storeId: req.storeId });
        if (!integration || !integration.isPixelEnabled || !integration.pixelId) {
            return res.status(200).json({ 
                success: true, 
                enabled: false 
            });
        }

        // Return only public-safe fields
        res.status(200).json({
            success: true,
            isPixelEnabled: integration.isPixelEnabled,
            pixelId: integration.pixelId,
            dataSharingLevel: integration.dataSharingLevel,
            enabledEvents: integration.enabledEvents,
            deduplicationEnabled: integration.deduplicationEnabled || false,
            hasCapiToken: !!integration.capiAccessTokenEncrypted
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
