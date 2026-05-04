const express = require('express');
const { Client, Reservation, Bill, Hall, Event, EventPackage, Feedback, Room } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

// ════════════════════════════════════════
// GUESTS
// ════════════════════════════════════════
const guestsRouter = express.Router();

guestsRouter.get('/', authenticate, async (req, res) => {
    try {
        const guests = await Client.find({}, '-password').sort('-createdAt');
        // Add booking count
        const data = await Promise.all(guests.map(async g => {
            const count = await Reservation.countDocuments({ client: g._id });
            return { ...g.toObject(), total_bookings: count };
        }));
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

guestsRouter.get('/:id/bookings', authenticate, async (req, res) => {
    try {
        const bookings = await Reservation.find({ client: req.params.id })
            .populate({ path: 'room', populate: { path: 'room_type' } })
            .sort('-createdAt');
        res.json({ success: true, data: bookings });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

guestsRouter.get('/report', authenticate, authorize('admin'), async (req, res) => {
    try {
        const since = new Date(Date.now() - 7*24*60*60*1000);
        const data = await Reservation.find({ createdAt: { $gte: since } })
            .populate('client', 'full_name email phone')
            .populate({ path: 'room', populate: 'room_type' });
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// BILLING
// ════════════════════════════════════════
const billingRouter = express.Router();

billingRouter.get('/reservation/:resId', authenticate, async (req, res) => {
    try {
        const bill = await Bill.findOne({ reservation: req.params.resId });
        res.json({ success: true, data: bill });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

billingRouter.post('/', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        const { reservation_id, extra_charges, extra_description, tax_rate, discount_percent, payment_method } = req.body;
        const reservation = await Reservation.findById(reservation_id).populate('room');
        if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });

        const checkOut = reservation.actual_checkout_date || reservation.check_out_date;
        const nights = Math.max(1, Math.ceil((new Date(checkOut) - new Date(reservation.check_in_date)) / (1000*60*60*24)));
        const room_charges = nights * reservation.room.price_per_night;
        const extra = parseFloat(extra_charges) || 0;
        const subtotal = room_charges + extra;
        const tax_amount = subtotal * ((parseFloat(tax_rate)||10) / 100);
        const discount_amount = subtotal * ((parseFloat(discount_percent)||0) / 100);
        const total_amount = subtotal + tax_amount - discount_amount;

        const billData = { room_charges, extra_charges: extra, extra_description, tax_rate: tax_rate||10, tax_amount, discount_percent: discount_percent||0, discount_amount, total_amount, payment_method: payment_method||'cash' };
        const bill = await Bill.findOneAndUpdate({ reservation: reservation_id }, billData, { upsert: true, new: true });
        res.json({ success: true, message: 'Bill generated', total: total_amount, nights, room_charges, billId: bill._id });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

billingRouter.put('/:id/pay', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        const bill = await Bill.findByIdAndUpdate(req.params.id, { payment_status: 'paid', paid_at: new Date() }, { new: true });
        await Reservation.findOneAndUpdate({ _id: bill.reservation, status: 'checked_in' }, { status: 'checked_out' });
        res.json({ success: true, message: 'Payment confirmed' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

billingRouter.get('/report/weekly', authenticate, authorize('admin'), async (req, res) => {
    try {
        const since = new Date(Date.now() - 7*24*60*60*1000);
        const data = await Bill.find({ createdAt: { $gte: since } })
            .populate({ path: 'reservation', populate: [{ path: 'room' }, { path: 'client', select: 'full_name' }] });
        const summary = {
            total_revenue: data.filter(b=>b.payment_status==='paid').reduce((s,b)=>s+b.total_amount, 0),
            total_tax: data.reduce((s,b)=>s+b.tax_amount, 0),
            total_discounts: data.reduce((s,b)=>s+b.discount_amount, 0)
        };
        res.json({ success: true, data, summary });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// EVENTS
// ════════════════════════════════════════
const eventsRouter = express.Router();

eventsRouter.get('/', authenticate, async (req, res) => {
    try {
        const events = await Event.find()
            .populate('hall', 'name capacity price_per_hour')
            .populate('package', 'name price season')
            .sort('-event_date');
        res.json({ success: true, data: events });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

eventsRouter.get('/halls', authenticate, async (req, res) => {
    try {
        const halls = await Hall.find();
        res.json({ success: true, data: halls });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

eventsRouter.get('/packages', authenticate, async (req, res) => {
    try {
        const { season } = req.query;
        const query = { is_active: true };
        if (season) query.season = season;
        const pkgs = await EventPackage.find(query);
        res.json({ success: true, data: pkgs });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

eventsRouter.get('/halls/:hallId/availability', authenticate, async (req, res) => {
    try {
        const { date } = req.query;
        const events = await Event.find({ hall: req.params.hallId, event_date: new Date(date), status: { $ne: 'cancelled' } });
        res.json({ success: true, data: events, available: events.length === 0 });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

eventsRouter.post('/', authenticate, async (req, res) => {
    try {
        const { hall_id, event_date, start_time, end_time, title, event_type } = req.body;

        // Validate required fields
        if (!title) return res.status(400).json({ success: false, message: 'Event title is required' });
        if (!event_type) return res.status(400).json({ success: false, message: 'Event type is required' });
        if (!hall_id) return res.status(400).json({ success: false, message: 'Please select a hall' });
        if (!event_date) return res.status(400).json({ success: false, message: 'Event date is required' });
        if (!start_time) return res.status(400).json({ success: false, message: 'Start time is required' });
        if (!end_time) return res.status(400).json({ success: false, message: 'End time is required' });

        // Conflict check
        const conflict = await Event.findOne({
            hall: hall_id,
            event_date: new Date(event_date),
            status: { $ne: 'cancelled' },
            $or: [{ $and: [{ start_time: { $lt: end_time } }, { end_time: { $gt: start_time } }] }]
        });
        if (conflict) return res.status(400).json({ success: false, message: `Hall already booked from ${conflict.start_time} to ${conflict.end_time}` });

        const eventData = {
            title, event_type,
            hall: hall_id,
            event_date: new Date(event_date),
            start_time, end_time,
            client_name: req.body.client_name,
            client_email: req.body.client_email,
            notes: req.body.notes,
            status: 'scheduled'
        };
        if (req.body.guest_count) eventData.guest_count = req.body.guest_count;
        if (req.body.total_price) eventData.total_price = req.body.total_price;
        if (req.body.package_id) eventData.package = req.body.package_id;
        if (req.user.role === 'client') eventData.client = req.user.id;

        const event = await Event.create(eventData);
        res.json({ success: true, message: 'Event scheduled successfully!', id: event._id });
    } catch (err) {
        console.error('Event create error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

eventsRouter.put('/:id', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        // If only status update (complete)
        if (req.body.status && Object.keys(req.body).length === 1) {
            await Event.findByIdAndUpdate(req.params.id, { status: req.body.status });
            return res.json({ success: true, message: `Event marked as ${req.body.status}` });
        }
        const updateData = { ...req.body };
        if (req.body.hall_id) updateData.hall = req.body.hall_id;
        if (!req.body.package_id) delete updateData.package;
        else updateData.package = req.body.package_id;
        delete updateData.hall_id;
        delete updateData.package_id;
        await Event.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true, message: 'Event updated successfully!' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

eventsRouter.delete('/:id', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        await Event.findByIdAndUpdate(req.params.id, { status: 'cancelled' });
        res.json({ success: true, message: 'Event cancelled' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Permanent delete (admin only, must be cancelled first)
eventsRouter.delete('/:id/permanent', authenticate, authorize('admin'), async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
        await Event.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Event permanently deleted' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

eventsRouter.get('/report/revenue', authenticate, authorize('admin'), async (req, res) => {
    try {
        const since = new Date(Date.now() - 30*24*60*60*1000);
        const data = await Event.aggregate([
            { $match: { status: { $ne: 'cancelled' }, event_date: { $gte: since } } },
            { $group: { _id: '$event_type', count: { $sum: 1 }, revenue: { $sum: '$total_price' } } }
        ]);
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// FEEDBACK
// ════════════════════════════════════════
const feedbackRouter = express.Router();

// Staff see all feedback; guests see only recent 10 public reviews
feedbackRouter.get('/', async (req, res) => {
    try {
        const isStaff = req.headers['authorization'] ? (() => {
            try {
                const jwt = require('jsonwebtoken');
                const token = req.headers['authorization'].split(' ')[1];
                const user = jwt.verify(token, process.env.JWT_SECRET);
                return ['admin','receptionist','staff'].includes(user.role);
            } catch { return false; }
        })() : false;

        const data = isStaff
            ? await Feedback.find().sort('-createdAt')           // staff see all
            : await Feedback.find().sort('-createdAt').limit(10); // guests see recent 10
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

feedbackRouter.post('/', async (req, res) => {
    try {
        await Feedback.create(req.body);
        res.json({ success: true, message: 'Thank you for your feedback! 🌟' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

feedbackRouter.delete('/:id', authenticate, authorize('admin','receptionist'), async (req, res) => {
    try {
        await Feedback.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Feedback deleted' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════
const reportsRouter = express.Router();

reportsRouter.get('/dashboard', authenticate, async (req, res) => {
    try {
        const [total, available, occupied, maintenance] = await Promise.all([
            Room.countDocuments(),
            Room.countDocuments({ status: 'available' }),
            Room.countDocuments({ status: 'occupied' }),
            Room.countDocuments({ status: 'maintenance' })
        ]);
        const today = new Date(); today.setHours(0,0,0,0);
        const todayBills = await Bill.find({ payment_status: 'paid', paid_at: { $gte: today } });
        const total_revenue = todayBills.reduce((s,b) => s + b.total_amount, 0);
        const feedbackAvg = await Feedback.aggregate([{ $group: { _id: null, avg: { $avg: '$rating' } } }]);
        res.json({ success: true, data: { total_rooms: total, available, occupied, maintenance, total_revenue, avg_rating: feedbackAvg[0]?.avg?.toFixed(1) || null } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

reportsRouter.get('/occupancy', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { period } = req.query;
        const days = period === 'monthly' ? 30 : period === 'weekly' ? 7 : 1;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const data = await Reservation.aggregate([
            { $match: { check_in_date: { $gte: since }, status: { $ne: 'cancelled' } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$check_in_date' } }, bookings: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);
        res.json({ success: true, data: data.map(d => ({ date: d._id, bookings: d.bookings })) });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

reportsRouter.get('/profit-loss', authenticate, authorize('admin'), async (req, res) => {
    try {
        const since = new Date(Date.now() - 30*24*60*60*1000);
        const result = await Bill.aggregate([
            { $match: { payment_status: 'paid', createdAt: { $gte: since } } },
            { $group: { _id: null, room_revenue: { $sum: '$room_charges' }, extra_revenue: { $sum: '$extra_charges' }, total_tax: { $sum: '$tax_amount' }, total_discounts: { $sum: '$discount_amount' }, gross_revenue: { $sum: '$total_amount' } } }
        ]);
        res.json({ success: true, data: result[0] || { room_revenue:0, extra_revenue:0, total_tax:0, total_discounts:0, gross_revenue:0 } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = { guestsRouter, billingRouter, eventsRouter, feedbackRouter, reportsRouter };
