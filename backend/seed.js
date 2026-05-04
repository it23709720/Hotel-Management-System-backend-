require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, RoomType, Room, Hall, EventPackage } = require('./models');

async function seed() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hotel_management');
    console.log('Connected to MongoDB...');
    await Promise.all([User.deleteMany(), RoomType.deleteMany(), Room.deleteMany(), Hall.deleteMany(), EventPackage.deleteMany()]);
    console.log('Cleared old data...');
    const hash = await bcrypt.hash('admin123', 10);
    await User.collection.insertMany([
        { username: 'admin', password: hash, full_name: 'Hotel Admin', email: 'gihinduherath1234@gmail.com', role: 'admin', is_active: true, createdAt: new Date(), updatedAt: new Date() },
        { username: 'receptionist1', password: hash, full_name: 'Sarah Johnson', email: 'sarah@hotel.com', role: 'receptionist', is_active: true, createdAt: new Date(), updatedAt: new Date() },
        { username: 'staff1', password: hash, full_name: 'Mike Smith', email: 'mike@hotel.com', role: 'staff', is_active: true, createdAt: new Date(), updatedAt: new Date() }
    ]);
    console.log('Users created');
    const types = await RoomType.insertMany([
        { type_name: 'Single', max_occupancy: 1, base_price: 80 },
        { type_name: 'Double', max_occupancy: 2, base_price: 120 },
        { type_name: 'Deluxe', max_occupancy: 2, base_price: 180 },
        { type_name: 'Suite', max_occupancy: 4, base_price: 350 }
    ]);
    console.log('Room types created');
    await Room.insertMany([
        { room_number: '101', room_type: types[0]._id, price_per_night: 80, floor: 1, amenities: ['Wi-Fi','TV'] },
        { room_number: '102', room_type: types[0]._id, price_per_night: 80, floor: 1, amenities: ['Wi-Fi','TV'] },
        { room_number: '201', room_type: types[1]._id, price_per_night: 120, floor: 2, amenities: ['Wi-Fi','AC','TV'] },
        { room_number: '202', room_type: types[2]._id, price_per_night: 180, floor: 2, amenities: ['Wi-Fi','AC','TV','Balcony'] },
        { room_number: '301', room_type: types[3]._id, price_per_night: 350, floor: 3, amenities: ['Wi-Fi','AC','TV','Mini Bar','Sea View'] }
    ]);
    console.log('Rooms created');
    await Hall.insertMany([
        { name: 'Grand Ballroom', capacity: 500, price_per_hour: 500 },
        { name: 'Conference Room A', capacity: 50, price_per_hour: 150 },
        { name: 'Garden Terrace', capacity: 200, price_per_hour: 300 }
    ]);
    console.log('Halls created');
    await EventPackage.insertMany([
        { name: 'Peak Wedding Package', season: 'peak', price: 5000, services: 'Catering, Decoration', is_active: true },
        { name: 'Standard Conference', season: 'normal', price: 1500, services: 'AV Equipment', is_active: true }
    ]);
    console.log('Event packages created');
    console.log('Seed complete! Login: admin / admin123');
    process.exit(0);
}
seed().catch(err => { console.error(err); process.exit(1); });
