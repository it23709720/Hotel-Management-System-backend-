const router = require('express').Router();
const nodemailer = require('nodemailer');
const { Reservation, Room, Bill } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
require('dotenv').config();

// ════════════════════════════════════════
// EMAIL SETUP
// ════════════════════════════════════════
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function sendEmail(to, subject, html) {
    try {
        await transporter.sendMail({ from: `"Grand Azure Hotel" <${process.env.EMAIL_USER}>`, to, subject, html });
        console.log(`Email sent to ${to}`);
    } catch (e) { console.log('Email failed:', e.message); }
}

function emailWrapper(content) {
    return `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden">
      <div style="background:#0D1B2A;padding:24px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:22px">Grand Azure Hotel</h1>
        <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:13px">Luxury & Comfort</p>
      </div>
      <div style="padding:28px">${content}</div>
      <div style="background:#f8f9fa;padding:16px;text-align:center;font-size:12px;color:#999;border-top:1px solid #e0e0e0">
        Grand Azure Hotel | support@grandazure.com | +60 3-1234 5678
      </div>
    </div>`;
}

function infoTable(rows) {
    return `<table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
      ${rows.map((r, i) => `<tr style="background:${i%2===0?'#f8f9fa':'#fff'}">
        <td style="padding:10px 14px;border:1px solid #ddd;font-weight:600;width:40%;color:#0D1B2A">${r[0]}</td>
        <td style="padding:10px 14px;border:1px solid #ddd;color:#444">${r[1]}</td>
      </tr>`).join('')}
    </table>`;
}

// ════════════════════════════════════════
// AUTO SCHEDULE REMINDER EMAILS
// 1 hour before check-in  (2PM) = 1PM reminder
// 1 hour before check-out (12PM) = 11AM reminder
// ════════════════════════════════════════
function scheduleReminders(reservationId, guestName, guestEmail, checkInDate, checkOutDate, roomNumber) {
    if (!guestEmail) return;
    const now = new Date();

    // Check-in reminder: 7:00 AM (1 hour before 8:00 AM check-in)
    const checkInReminder = new Date(checkInDate);
    checkInReminder.setHours(7, 0, 0, 0);
    const checkInDelay = checkInReminder - now;
    if (checkInDelay > 0) {
        setTimeout(async () => {
            await sendEmail(guestEmail, '⏰ Check-in Reminder — Grand Azure Hotel',
                emailWrapper(`
                    <h2 style="color:#0D1B2A">Check-in Reminder</h2>
                    <p>Dear <strong>${guestName}</strong>,</p>
                    <p>Your check-in at <strong>Grand Azure Hotel</strong> is in <strong>1 hour</strong>. We are ready to welcome you!</p>
                    ${infoTable([
                        ['Room', roomNumber],
                        ['Check-in Date', checkInDate],
                        ['Check-in Time', '8:00 AM'],
                        ['Location', 'Grand Azure Hotel, Main Lobby']
                    ])}
                    <p style="color:#666;font-size:13px">Please have your booking ID and ID document ready at the front desk.</p>
                `));
            console.log('Check-in reminder sent to ' + guestEmail);
        }, checkInDelay);
        console.log('Check-in reminder scheduled for ' + guestEmail + ' at ' + checkInReminder);
    } else {
        console.log('Check-in reminder skipped (past time) for ' + guestEmail);
    }

    // Check-out reminder: 3:00 PM (1 hour before 4:00 PM check-out)
    const checkOutReminder = new Date(checkOutDate);
    checkOutReminder.setHours(15, 0, 0, 0);
    const checkOutDelay = checkOutReminder - now;
    if (checkOutDelay > 0) {
        setTimeout(async () => {
            await sendEmail(guestEmail, '⏰ Check-out Reminder — Grand Azure Hotel',
                emailWrapper(`
                    <h2 style="color:#0D1B2A">Check-out Reminder</h2>
                    <p>Dear <strong>${guestName}</strong>,</p>
                    <p>Your check-out is in <strong>1 hour</strong>. We hope you enjoyed your stay!</p>
                    ${infoTable([
                        ['Room', roomNumber],
                        ['Check-out Date', checkOutDate],
                        ['Check-out Time', '4:00 PM']
                    ])}
                    <p style="color:#666;font-size:13px">Please ensure all belongings are packed and return your room key to the front desk.</p>
                `));
            console.log('Check-out reminder sent to ' + guestEmail);
        }, checkOutDelay);
        console.log('Check-out reminder scheduled for ' + guestEmail + ' at ' + checkOutReminder);
    } else {
        console.log('Check-out reminder skipped (past time) for ' + guestEmail);
    }
}

// ════════════════════════════════════════
// GET ALL RESERVATIONS
// ════════════════════════════════════════
router.get('/', authenticate, async (req, res) => {
    try {
        let query = {};
        if (req.query.status) query.status = req.query.status;
        if (req.user.role === 'client') query.client = req.user.id;
        const reservations = await Reservation.find(query)
            .populate({ path: 'room', populate: { path: 'room_type' } })
            .sort('-createdAt');
        res.json({ success: true, data: reservations });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// CREATE RESERVATION
// ════════════════════════════════════════
router.post('/', authenticate, async (req, res) => {
    try {
        const { room_id, check_in_date, check_out_date, guest_name, guest_email, guest_phone, special_requests } = req.body;

        if (!room_id) return res.status(400).json({ success: false, message: 'Please select a room' });
        if (!check_in_date || !check_out_date) return res.status(400).json({ success: false, message: 'Check-in and check-out dates are required' });
        if (!guest_name) return res.status(400).json({ success: false, message: 'Guest name is required' });

        // Check availability
        const conflict = await Reservation.findOne({
            room: room_id,
            status: { $in: ['reserved', 'checked_in'] },
            check_in_date: { $lt: new Date(check_out_date) },
            check_out_date: { $gt: new Date(check_in_date) }
        });
        if (conflict) return res.status(400).json({ success: false, message: 'Room is not available for the selected dates' });

        // Create reservation
        const reservation = await Reservation.create({
            client: req.user.role === 'client' ? req.user.id : undefined,
            created_by: req.user.role !== 'client' ? req.user.id : undefined,
            guest_name, guest_email, guest_phone,
            room: room_id, check_in_date, check_out_date, special_requests,
            status: 'reserved'
        });

        await Room.findByIdAndUpdate(room_id, { status: 'occupied' });

        // Send booking confirmation email
        if (guest_email) {
            const nights = Math.max(1, Math.ceil((new Date(check_out_date) - new Date(check_in_date)) / (1000*60*60*24)));
            const room = await Room.findById(room_id).populate('room_type');
            const roomNum = room ? room.room_number : '—';
            const roomType = room && room.room_type ? room.room_type.type_name : '—';
            const pricePerNight = room ? parseFloat(room.price_per_night) : 0;
            const estimatedTotal = (pricePerNight * nights * 1.1).toFixed(2);

            await sendEmail(guest_email, 'Booking Confirmed — Grand Azure Hotel',
                emailWrapper(`
                    <h2 style="color:#0D1B2A">Booking Confirmed!</h2>
                    <p>Dear <strong>${guest_name}</strong>,</p>
                    <p>Your reservation at <strong>Grand Azure Hotel</strong> is confirmed. We look forward to welcoming you!</p>
                    ${infoTable([
                        ['Booking ID', '#' + reservation._id],
                        ['Room Number', roomNum],
                        ['Room Type', roomType],
                        ['Check-in Date', check_in_date + ' at 8:00 AM'],
                        ['Check-out Date', check_out_date + ' at 4:00 PM'],
                        ['Duration', nights + ' night' + (nights > 1 ? 's' : '')],
                        ['Rate', 'RM ' + pricePerNight.toFixed(2) + ' / night'],
                        ['Estimated Total', 'RM ' + estimatedTotal + ' (incl. 10% tax)'],
                        ...(special_requests ? [['Special Requests', special_requests]] : [])
                    ])}
                    <div style="background:#FFF8E1;border-left:4px solid #C9A84C;padding:14px;border-radius:4px;margin:16px 0;font-size:13px">
                        <strong>Reminder Emails</strong><br>
                        You will automatically receive a reminder email 1 hour before check-in (7:00 AM) and 1 hour before check-out (3:00 PM).
                    </div>
                    <p style="color:#666;font-size:13px">If you need to make changes, please contact us at least 24 hours before check-in.</p>
                `));

            // Schedule auto reminders
            scheduleReminders(reservation._id, guest_name, guest_email, check_in_date, check_out_date, roomNum);
        }

        res.json({ success: true, message: 'Reservation created! Confirmation email sent.', id: reservation._id });
    } catch (err) {
        console.error('Reservation error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════
// UPDATE RESERVATION
// ════════════════════════════════════════
router.put('/:id', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
    try {
        await Reservation.findByIdAndUpdate(req.params.id, req.body);
        res.json({ success: true, message: 'Reservation updated' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// CANCEL RESERVATION
// ════════════════════════════════════════
router.put('/:id/cancel', authenticate, async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return res.status(404).json({ success: false, message: 'Not found' });
        if (req.user.role === 'client' && String(reservation.client) !== String(req.user.id))
            return res.status(403).json({ success: false, message: 'You can only cancel your own reservations' });

        reservation.status = 'cancelled';
        reservation.cancellation_reason = req.body.cancellation_reason || 'Not specified';
        await reservation.save();
        await Room.findByIdAndUpdate(reservation.room, { status: 'available' });

        if (reservation.guest_email) {
            await sendEmail(reservation.guest_email, 'Reservation Cancelled — Grand Azure Hotel',
                emailWrapper(`
                    <h2 style="color:#c0392b">Reservation Cancelled</h2>
                    <p>Dear <strong>${reservation.guest_name}</strong>, your reservation has been cancelled.</p>
                    ${infoTable([
                        ['Booking ID', '#' + reservation._id],
                        ['Reason', req.body.cancellation_reason || 'Not specified']
                    ])}
                    <p>If this was a mistake, please contact us immediately.</p>
                `));
        }

        res.json({ success: true, message: 'Reservation cancelled' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// CHECK-IN
// ════════════════════════════════════════
router.put('/:id/checkin', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
    try {
        const reservation = await Reservation.findByIdAndUpdate(req.params.id, { status: 'checked_in' }, { new: true }).populate('room');
        if (!reservation) return res.status(404).json({ success: false, message: 'Not found' });
        await Room.findByIdAndUpdate(reservation.room._id, { status: 'occupied' });

        if (reservation.guest_email) {
            await sendEmail(reservation.guest_email, 'Welcome — Check-in Confirmed',
                emailWrapper(`
                    <h2 style="color:#0D1B2A">Welcome to Grand Azure Hotel!</h2>
                    <p>Dear <strong>${reservation.guest_name}</strong>, your check-in is confirmed. Enjoy your stay!</p>
                    ${infoTable([
                        ['Room', reservation.room?.room_number || '—'],
                        ['Check-in Time', new Date().toLocaleString()],
                        ['Check-out', reservation.check_out_date?.toISOString?.()?.split('T')[0] + ' at 12:00 PM']
                    ])}
                `));
        }

        res.json({ success: true, message: 'Check-in successful' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// CHECK-OUT + AUTO BILL
// ════════════════════════════════════════
router.put('/:id/checkout', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id).populate('room');
        if (!reservation) return res.status(404).json({ success: false, message: 'Not found' });

        const today = new Date();
        const isEarly = today < new Date(reservation.check_out_date);

        reservation.status = 'checked_out';
        reservation.actual_checkout_date = today;
        await reservation.save();
        await Room.findByIdAndUpdate(reservation.room._id, { status: 'available' });

        // Auto-generate bill
        const nights = Math.max(1, Math.ceil((today - new Date(reservation.check_in_date)) / (1000*60*60*24)));
        const room_charges = nights * (reservation.room.price_per_night || 0);
        const tax_rate = 10;
        const tax_amount = room_charges * (tax_rate / 100);
        const total_amount = room_charges + tax_amount;

        const bill = await Bill.findOneAndUpdate(
            { reservation: reservation._id },
            { room_charges, extra_charges: 0, tax_rate, tax_amount, discount_percent: 0, discount_amount: 0, total_amount, payment_method: 'cash', payment_status: 'pending' },
            { upsert: true, new: true }
        );

        if (isEarly) {
            const dateStr = today.toISOString().split('T')[0];
            await sendEmail(process.env.EMAIL_USER, `Early Checkout — Room ${reservation.room.room_number}`,
                emailWrapper(`
                    <h2 style="color:#c0392b">Early Checkout Alert</h2>
                    ${infoTable([
                        ['Guest', reservation.guest_name],
                        ['Room', reservation.room.room_number],
                        ['Original Checkout', reservation.check_out_date?.toISOString?.()?.split('T')[0]],
                        ['Actual Checkout', dateStr],
                        ['Bill Total', 'RM ' + total_amount.toFixed(2)]
                    ])}
                `));
            if (reservation.guest_email) {
                await sendEmail(reservation.guest_email, 'Early Checkout Confirmed — Grand Azure Hotel',
                    emailWrapper(`
                        <h2 style="color:#0D1B2A">Early Checkout Confirmed</h2>
                        <p>Dear <strong>${reservation.guest_name}</strong>, your early checkout on <strong>${dateStr}</strong> has been processed.</p>
                        ${infoTable([
                            ['Room', reservation.room.room_number],
                            ['Nights Stayed', nights],
                            ['Total Bill', 'RM ' + total_amount.toFixed(2)]
                        ])}
                        <p>Thank you for staying with us!</p>
                    `));
            }
        }

        res.json({
            success: true,
            message: isEarly ? 'Early checkout processed. Notifications sent.' : 'Check-out successful! Bill generated.',
            isEarly,
            bill: { id: bill._id, room_charges, nights, tax_rate, tax_amount, total_amount, room_number: reservation.room.room_number, guest_name: reservation.guest_name, check_in_date: reservation.check_in_date, check_out_date: today }
        });
    } catch (err) {
        console.error('Checkout error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ════════════════════════════════════════
// MANUAL SEND REMINDER EMAIL
// ════════════════════════════════════════
router.post('/:id/send-reminder', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
    try {
        const { type, guest_name, guest_email, checkin, checkout, room_number } = req.body;
        if (!guest_email) return res.status(400).json({ success: false, message: 'Guest has no email address' });

        if (type === 'checkin') {
            await sendEmail(guest_email, 'Check-in Reminder — Grand Azure Hotel',
                emailWrapper(`
                    <h2 style="color:#0D1B2A">Check-in Reminder</h2>
                    <p>Dear <strong>${guest_name}</strong>, this is a reminder for your upcoming check-in.</p>
                    ${infoTable([['Room', room_number], ['Check-in Date', checkin], ['Check-in Time', '8:00 AM']])}
                `));
        } else {
            await sendEmail(guest_email, 'Check-out Reminder — Grand Azure Hotel',
                emailWrapper(`
                    <h2 style="color:#0D1B2A">Check-out Reminder</h2>
                    <p>Dear <strong>${guest_name}</strong>, this is a reminder for your upcoming check-out.</p>
                    ${infoTable([['Room', room_number], ['Check-out Date', checkout], ['Check-out Time', '4:00 PM']])}
                `));
        }
        res.json({ success: true, message: `${type === 'checkin' ? 'Check-in' : 'Check-out'} reminder sent to ${guest_email}` });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// WEEKLY REPORT
// ════════════════════════════════════════
router.get('/report/weekly', authenticate, authorize('admin'), async (req, res) => {
    try {
        const since = new Date(Date.now() - 7*24*60*60*1000);
        const data = await Reservation.find({ createdAt: { $gte: since } })
            .populate({ path: 'room', populate: { path: 'room_type' } });
        const summary = {
            total: data.length,
            reserved: data.filter(r=>r.status==='reserved').length,
            checked_in: data.filter(r=>r.status==='checked_in').length,
            checked_out: data.filter(r=>r.status==='checked_out').length,
            cancelled: data.filter(r=>r.status==='cancelled').length,
            early_checkout: data.filter(r=>r.actual_checkout_date && r.actual_checkout_date < r.check_out_date).length
        };
        res.json({ success: true, data, summary });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════
// DELETE RESERVATION (Admin only)
// ════════════════════════════════════════
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
        if (reservation.status === 'reserved' || reservation.status === 'checked_in') {
            await Room.findByIdAndUpdate(reservation.room, { status: 'available' });
        }
        await Bill.deleteOne({ reservation: reservation._id });
        await Reservation.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Reservation deleted successfully' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
