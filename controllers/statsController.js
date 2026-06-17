const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');

// @desc    Get dashboard statistics
// @route   GET /api/stats/dashboard
// @access  Private/Admin
exports.getDashboardStats = async (req, res) => {
    try {
        const { month, year } = req.query;

        const now = new Date();
        const currentYear = year ? parseInt(year) : now.getFullYear();
        const currentMonth = month ? parseInt(month) - 1 : now.getMonth(); // 0-indexed

        // Define time ranges for Selected Month
        const startOfSelectedMonth = new Date(currentYear, currentMonth, 1);
        const endOfSelectedMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

        // Define time ranges for Previous Month (for trends)
        const startOfPrevMonth = new Date(currentYear, currentMonth - 1, 1);
        const endOfPrevMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);

        // Helper for basic counts in range
        const scope = req.storeId ? { storeId: req.storeId } : {};
        const countInDateRange = async (Model, query = {}) => {
            return await Model.countDocuments({
                ...scope,
                ...query,
                createdAt: { $gte: startOfSelectedMonth, $lte: endOfSelectedMonth }
            });
        };

        const countInPrevRange = async (Model, query = {}) => {
            return await Model.countDocuments({
                ...scope,
                ...query,
                createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
            });
        };

        // 1. Total Orders (Selected Month)
        const totalOrders = await countInDateRange(Order);
        const prevTotalOrders = await countInPrevRange(Order);

        // 2. Gross Revenue (Selected Month, Only Delivered)
        const revenueOrders = await Order.find({
            ...scope,
            orderStatus: 'delivered',
            createdAt: { $gte: startOfSelectedMonth, $lte: endOfSelectedMonth }
        });
        const totalRevenue = revenueOrders.reduce((acc, order) => acc + (order.totalAmount || 0), 0);

        const prevRevenueOrders = await Order.find({
            ...scope,
            orderStatus: 'delivered',
            createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
        });
        const prevTotalRevenue = prevRevenueOrders.reduce((acc, order) => acc + (order.totalAmount || 0), 0);

        // 3. Customer Base (Global Count)
        const Customer = require('../models/Customer');
        const totalCustomers = req.storeId
            ? await Customer.countDocuments({ storeId: req.storeId })
            : await User.countDocuments({ role: 'customer' });

        // New Customers in current month (for trend calculation)
        const newCustomersThisMonth = req.storeId ? await countInDateRange(Customer) : await countInDateRange(User, { role: 'customer' });
        const newCustomersPrevMonth = req.storeId ? await countInPrevRange(Customer) : await countInPrevRange(User, { role: 'customer' });

        // 4. Avg Order Value (Selected Month)
        // Using all non-cancelled orders for better sample size, or just delivered to be strict.
        // Let's stick to Delivered for consistency with Revenue
        const avgOrderValue = totalOrders > 0 ? totalRevenue / revenueOrders.length : 0; // Note: revenueOrders is only delivered. 
        // Iterate: strict AOV = Revenue / Delivered Orders
        const realAOV = revenueOrders.length > 0 ? totalRevenue / revenueOrders.length : 0;

        const prevRealAOV = prevRevenueOrders.length > 0 ? prevTotalRevenue / prevRevenueOrders.length : 0;

        // 5. Total Products (Global - snapshot not really possible without history, just return current)
        const totalProducts = await Product.countDocuments(scope);

        // Calculate Trends
        const calculateTrend = (curr, prev) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return parseFloat(((curr - prev) / prev * 100).toFixed(1));
        };

        const revenueTrend = calculateTrend(totalRevenue, prevTotalRevenue);
        const ordersTrend = calculateTrend(totalOrders, prevTotalOrders);
        const customersTrend = calculateTrend(newCustomersThisMonth, newCustomersPrevMonth);
        const aovTrend = calculateTrend(realAOV, prevRealAOV);

        res.status(200).json({
            success: true,
            data: {
                totalOrders,
                totalRevenue,
                totalCustomers,
                totalProducts,
                avgOrderValue: realAOV,
                trends: {
                    revenue: revenueTrend,
                    orders: ordersTrend,
                    aov: aovTrend,
                    customers: customersTrend
                },
                meta: {
                    month: currentMonth + 1,
                    year: currentYear
                }
            }
        });
    } catch (err) {
        console.error('Stats Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// @desc    Get Revenue Progress Chart Data
// @route   GET /api/stats/progress
// @access  Private/Admin
exports.getRevenueProgress = async (req, res) => {
    try {
        const { filter = 'day', month, year } = req.query;

        const now = new Date();
        const currentYear = year ? parseInt(year) : now.getFullYear();
        const currentMonth = month ? parseInt(month) - 1 : now.getMonth();

        let match = {
            orderStatus: 'delivered',
            ...(req.storeId && { storeId: req.storeId })
        };

        // Apply Date Filtering Scope
        if (month && year) {
            const start = new Date(currentYear, currentMonth, 1);
            const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);
            match.createdAt = { $gte: start, $lte: end };
        } else if (year) {
            const start = new Date(currentYear, 0, 1);
            const end = new Date(currentYear, 11, 31, 23, 59, 59);
            match.createdAt = { $gte: start, $lte: end };
        }

        let groupBy = {};

        if (filter === 'day') {
            groupBy = {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
                day: { $dayOfMonth: "$createdAt" }
            };
        } else if (filter === 'month') {
            groupBy = {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" }
            };
        } else if (filter === 'year') {
            groupBy = { year: { $year: "$createdAt" } };
        } else {
            // Default fallback
            groupBy = {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
                day: { $dayOfMonth: "$createdAt" }
            };
        }

        const stats = await Order.aggregate([
            { $match: match },
            {
                $group: {
                    _id: groupBy,
                    revenue: { $sum: "$totalAmount" },
                    timestamp: { $first: "$createdAt" }
                }
            },
            { $sort: { timestamp: 1 } }
        ]);

        const chartData = stats.map(s => ({
            label: filter === 'day'
                ? new Date(s.timestamp).toLocaleDateString()
                : filter === 'year'
                    ? s._id.year.toString()
                    : new Date(s.timestamp).toLocaleString('default', { month: 'short', year: 'numeric' }),
            value: s.revenue
        }));

        res.status(200).json({
            success: true,
            data: chartData
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
