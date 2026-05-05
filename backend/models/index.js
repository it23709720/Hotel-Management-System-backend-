import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// ── USER (Staff) ──
const userSchema = new mongoose.Schema({
    username:  { type: String, required: true, unique: true, trim: true },
    password:  { type: String, required: true },
    full_name: { type: String, required: true },
    email:     { type: String, required: true, unique: true, lowercase: true },
    role:      { type: String, enum: ['admin','receptionist','staff'], required: true },
    is_active: { type: Boolean, default: true }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});
userSchema.methods.comparePassword = function(pw) { return bcrypt.compare(pw, this.password); };

// ── CLIENT (Guest account) ──
const clientSchema = new mongoose.Schema({
    username:  { type: String, required: true, unique: true, trim: true },
    password:  { type: String, required: true },
    full_name: { type: String, required: true },
    email:     { type: String, required: true, unique: true, lowercase: true },
    phone:     String,
    id_type:   { type: String, enum: ['passport','id_card','driving_license'] },
    id_number: String,
    is_active: { type: Boolean, default: true }
}, { timestamps: true });

clientSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});
clientSchema.methods.comparePassword = function(pw) { return bcrypt.compare(pw, this.password); };

// ── LOGIN LOG ──
const loginLogSchema = new mongoose.Schema({
    user_id:    { type: mongoose.Schema.Types.ObjectId },
    user_type:  { type: String, enum: ['staff','client'] },
    login_time: { type: Date, default: Date.now },
    logout_time:Date,
    ip_address: String
});

// ── ROOM TYPE ──
const roomTypeSchema = new mongoose.Schema({
    type_name:     { type: String, required: true },
    max_occupancy: { type: Number, required: true },
    base_price:    { type: Number, required: true },
    description:   String
});

// ── ROOM ──
const roomSchema = new mongoose.Schema({
    room_number:    { type: String, required: true, unique: true },
    room_type:      { type: mongoose.Schema.Types.ObjectId, ref: 'RoomType', required: true },
    price_per_night:{ type: Number, required: true },
    status:         { type: String, enum: ['available','occupied','maintenance'], default: 'available' },
    floor:          Number,
    amenities:      [String]
}, { timestamps: true });

// ── MAINTENANCE ──
const maintenanceSchema = new mongoose.Schema({
    room:           { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    assigned_staff: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason:         { type: String, required: true },
    start_date:     { type: Date, required: true },
    end_date:       Date,
    status:         { type: String, enum: ['ongoing','completed'], default: 'ongoing' }
}, { timestamps: true });

// ── RESERVATION ──
const reservationSchema = new mongoose.Schema({
    client:               { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    guest_name:           { type: String, required: true },
    guest_email:          String,
    guest_phone:          String,
    room:                 { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    check_in_date:        { type: Date, required: true },
    check_out_date:       { type: Date, required: true },
    actual_checkout_date: Date,
    status:               { type: String, enum: ['reserved','checked_in','checked_out','cancelled'], default: 'reserved' },
    special_requests:     String,
    cancellation_reason:  String,
    created_by:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// ── BILL ──
const billSchema = new mongoose.Schema({
    reservation:      { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation', required: true, unique: true },
    room_charges:     { type: Number, default: 0 },
    extra_charges:    { type: Number, default: 0 },
    extra_description:String,
    tax_rate:         { type: Number, default: 10 },
    tax_amount:       { type: Number, default: 0 },
    discount_percent: { type: Number, default: 0 },
    discount_amount:  { type: Number, default: 0 },
    total_amount:     { type: Number, required: true },
    payment_method:   { type: String, enum: ['cash','card','qr_code'], default: 'cash' },
    payment_status:   { type: String, enum: ['pending','paid','refunded'], default: 'pending' },
    paid_at:          Date
}, { timestamps: true });

// ── HALL ──
const hallSchema = new mongoose.Schema({
    name:          { type: String, required: true },
    capacity:      { type: Number, required: true },
    price_per_hour:{ type: Number, required: true },
    description:   String
});

// ── EVENT PACKAGE ──
const eventPackageSchema = new mongoose.Schema({
    name:      { type: String, required: true },
    season:    { type: String, enum: ['peak','normal','off'], required: true },
    price:     { type: Number, required: true },
    services:  String,
    description:String,
    is_active: { type: Boolean, default: true }
});

// ── EVENT ──
const eventSchema = new mongoose.Schema({
    title:        { type: String, required: true },
    event_type:   { type: String, enum: ['wedding','conference','party','meeting','other'], required: true },
    hall:         { type: mongoose.Schema.Types.ObjectId, ref: 'Hall', required: true },
    client:       { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
    client_name:  String,
    client_email: String,
    event_date:   { type: Date, required: true },
    start_time:   { type: String, required: true },
    end_time:     { type: String, required: true },
    guest_count:  Number,
    package:      { type: mongoose.Schema.Types.ObjectId, ref: 'EventPackage' },
    total_price:  Number,
    status:       { type: String, enum: ['scheduled','completed','cancelled'], default: 'scheduled' },
    notes:        String
}, { timestamps: true });

// ── FEEDBACK ──
const feedbackSchema = new mongoose.Schema({
    reservation: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' },
    guest_name:  String,
    rating:      { type: Number, min: 1, max: 5 },
    comments:    String,
    suggestions: String
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Client = mongoose.model('Client', clientSchema);
const LoginLog = mongoose.model('LoginLog', loginLogSchema);
const RoomType = mongoose.model('RoomType', roomTypeSchema);
const Room = mongoose.model('Room', roomSchema);
const Maintenance = mongoose.model('Maintenance', maintenanceSchema);
const Reservation = mongoose.model('Reservation', reservationSchema);
const Bill = mongoose.model('Bill', billSchema);
const Hall = mongoose.model('Hall', hallSchema);
const EventPackage = mongoose.model('EventPackage', eventPackageSchema);
const Event = mongoose.model('Event', eventSchema);
const Feedback = mongoose.model('Feedback', feedbackSchema);

export {
    User,
    Client,
    LoginLog,
    RoomType,
    Room,
    Maintenance,
    Reservation,
    Bill,
    Hall,
    EventPackage,
    Event,
    Feedback
};
