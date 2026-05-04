const router = require('express').Router();
const { Room, RoomType, Maintenance, Reservation, User } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

// Get all rooms
router.get('/', authenticate, async (req, res) => {
    try {
        const rooms = await Room.find().populate('room_type').sort('room_number');
        res.json({ success: true, data: rooms });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get available rooms (with optional date check)
router.get('/available', authenticate, async (req, res) => {
    try {
        const { check_in, check_out } = req.query;
        let rooms = await Room.find({ status: 'available' }).populate('room_type');
        if (check_in && check_out) {
            const booked = await Reservation.find({
                status: { $in: ['reserved','checked_in'] },
                check_in_date: { $lt: new Date(check_out) },
                check_out_date: { $gt: new Date(check_in) }
            }).distinct('room');
            rooms = rooms.filter(r => !booked.map(String).includes(String(r._id)));
        }
        res.json({ success: true, data: rooms });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Get room types
router.get('/types', authenticate, async (req, res) => {
    try {
        const types = await RoomType.find();
        res.json({ success: true, data: types });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Create room
router.post('/', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { room_number, room_type, room_type_id, price_per_night, floor, amenities, status } = req.body;
        const room = new Room({
            room_number,
            room_type: room_type || room_type_id,
            price_per_night,
            floor,
            amenities: amenities || [],
            status: status || 'available'
        });
        await room.save();
        res.json({ success: true, message: 'Room created successfully', id: room._id });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ success: false, message: 'Room number already exists' });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Update room
router.put('/:id', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        await Room.findByIdAndUpdate(req.params.id, req.body);
        res.json({ success: true, message: 'Room updated' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Delete room
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        await Room.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Room deleted' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── MAINTENANCE ──

// Get maintenance records
router.get('/maintenance', authenticate, async (req, res) => {
    try {
        const { filter } = req.query;
        let query = {};
        if (filter === 'today') query.start_date = { $gte: new Date(new Date().setHours(0,0,0,0)) };
        else if (filter === 'week') query.start_date = { $gte: new Date(Date.now() - 7*24*60*60*1000) };

        const records = await Maintenance.find(query)
            .populate({ path: 'room', populate: { path: 'room_type' } })
            .populate('assigned_staff', 'full_name')
            .sort('-start_date');
        res.json({ success: true, data: records });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Schedule maintenance
router.post('/maintenance', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        const { room_id, reason, start_date, assigned_staff_id } = req.body;
        if (!room_id) return res.status(400).json({ success: false, message: 'Room is required' });
        if (!reason) return res.status(400).json({ success: false, message: 'Reason is required' });

        const maintData = { room: room_id, reason, start_date: start_date || new Date() };
        // Only add assigned_staff if it's a valid non-empty value
        if (assigned_staff_id && assigned_staff_id !== 'undefined' && assigned_staff_id !== '') {
            maintData.assigned_staff = assigned_staff_id;
        }

        await Room.findByIdAndUpdate(room_id, { status: 'maintenance' });
        await Maintenance.create(maintData);
        res.json({ success: true, message: 'Maintenance scheduled successfully' });
    } catch (err) {
        console.error('Maintenance error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Complete maintenance
router.put('/maintenance/:id/complete', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        const maint = await Maintenance.findByIdAndUpdate(req.params.id, { status: 'completed', end_date: new Date() }, { new: true });
        if (!maint) return res.status(404).json({ success: false, message: 'Record not found' });
        await Room.findByIdAndUpdate(maint.room, { status: 'available' });
        res.json({ success: true, message: 'Maintenance completed! Room is now available.' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Delete maintenance record
router.delete('/maintenance/:id', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        const maint = await Maintenance.findById(req.params.id);
        if (!maint) return res.status(404).json({ success: false, message: 'Record not found' });
        // If ongoing, free up room
        if (maint.status === 'ongoing') {
            await Room.findByIdAndUpdate(maint.room, { status: 'available' });
        }
        await Maintenance.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Maintenance record deleted' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
