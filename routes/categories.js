const express = require('express');
const { getCategories, createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');

const router = express.Router();

router.get('/', protect, resolveActiveStore, requireStorePermission('view_products'), getCategories);
router.post('/', protect, resolveActiveStore, requireStorePermission('create_products'), createCategory);
router.put('/:id', protect, resolveActiveStore, requireStorePermission('edit_products'), updateCategory);
router.delete('/:id', protect, resolveActiveStore, requireStorePermission('delete_products'), deleteCategory);

module.exports = router;
