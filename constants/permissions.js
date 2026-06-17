const STORE_ROLES = [
    'owner',
    'manager',
    'product_manager',
    'order_manager',
    'support_agent',
    'delivery_manager',
    'marketing_manager',
    'viewer'
];

const STORE_PERMISSIONS = [
    'view_dashboard',
    'view_products',
    'create_products',
    'edit_products',
    'delete_products',
    'view_orders',
    'edit_orders',
    'cancel_orders',
    'mark_paid',
    'manage_delivery',
    'manage_payments',
    'manage_coupons',
    'manage_storefront',
    'publish_storefront',
    'manage_seo',
    'manage_meta',
    'manage_reviews',
    'manage_support',
    'view_analytics',
    'manage_staff',
    'manage_settings',
    'view_audit_logs'
];

const OWNER_ONLY_PERMISSIONS = [
    'delete_store',
    'transfer_ownership',
    'manage_payout_account',
    'manage_staff_permissions',
    'disconnect_integrations',
    'publish_store'
];

const ROLE_PERMISSIONS = {
    owner: [...STORE_PERMISSIONS, ...OWNER_ONLY_PERMISSIONS],
    manager: STORE_PERMISSIONS.filter(p => !OWNER_ONLY_PERMISSIONS.includes(p)),
    product_manager: ['view_dashboard', 'view_products', 'create_products', 'edit_products', 'delete_products', 'view_analytics'],
    order_manager: ['view_dashboard', 'view_orders', 'edit_orders', 'cancel_orders', 'mark_paid', 'manage_delivery', 'view_analytics'],
    support_agent: ['view_dashboard', 'manage_support', 'view_orders'],
    delivery_manager: ['view_dashboard', 'view_orders', 'edit_orders', 'manage_delivery'],
    marketing_manager: ['view_dashboard', 'manage_coupons', 'manage_storefront', 'publish_storefront', 'manage_seo', 'manage_meta', 'manage_reviews', 'view_analytics'],
    viewer: ['view_dashboard', 'view_products', 'view_orders', 'view_analytics']
};

const getRolePermissions = role => ROLE_PERMISSIONS[role] || [];

module.exports = {
    STORE_ROLES,
    STORE_PERMISSIONS,
    OWNER_ONLY_PERMISSIONS,
    ROLE_PERMISSIONS,
    getRolePermissions
};
