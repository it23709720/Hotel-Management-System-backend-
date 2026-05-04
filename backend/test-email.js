require('dotenv').config();
const nodemailer = require('nodemailer');

const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_PASS;

console.log('\n📧 Reading your .env file:');
console.log('EMAIL_USER =', user);
console.log('EMAIL_PASS =', pass ? `"${pass}" (${pass.length} characters)` : 'NOT SET');
console.log('Has spaces?', pass && pass.includes(' ') ? '❌ YES - remove spaces!' : '✅ No spaces');

if (!user || !pass) {
    console.log('\n❌ EMAIL_USER or EMAIL_PASS missing in .env!');
    process.exit(1);
}

if (pass.length !== 16) {
    console.log(`\n⚠️  Password is ${pass.length} characters. Google App Password must be exactly 16 characters!`);
}

// Try port 587
async function tryConnect(config, label) {
    return new Promise((resolve) => {
        console.log(`\n⏳ Trying ${label}...`);
        const t = nodemailer.createTransport(config);
        t.verify((err) => {
            if (err) {
                console.log(`❌ ${label} FAILED: ${err.message.split('\n')[0]}`);
                resolve(false);
            } else {
                console.log(`✅ ${label} WORKS!`);
                resolve(t);
            }
        });
    });
}

async function run() {
    // Try 587 TLS
    let transport = await tryConnect({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user, pass },
        tls: { rejectUnauthorized: false }
    }, 'Gmail Port 587 (TLS)');

    // Try 465 SSL
    if (!transport) {
        transport = await tryConnect({
            host: 'smtp.gmail.com', port: 465, secure: true,
            auth: { user, pass },
            tls: { rejectUnauthorized: false }
        }, 'Gmail Port 465 (SSL)');
    }

    if (!transport) {
        console.log('\n─────────────────────────────────');
        console.log('❌ Both methods failed.');
        console.log('\n✅ SOLUTION - Follow these EXACT steps:\n');
        console.log('1. Open Chrome → go to: myaccount.google.com');
        console.log('2. Click "Security" on the left');
        console.log('3. Under "How you sign in to Google"');
        console.log('   → Click "2-Step Verification" → make sure it is ON');
        console.log('4. Go to: myaccount.google.com/apppasswords');
        console.log('5. In the box type: hotel');
        console.log('6. Click CREATE');
        console.log('7. Copy the 16-letter password shown in yellow box');
        console.log('8. Open backend/.env file');
        console.log('9. Set EMAIL_PASS= then paste (no spaces between letters)');
        console.log('10. Save .env then run: node test-email.js again');
        console.log('\nOR use Mailtrap (free, no Gmail needed):');
        console.log('→ Go to mailtrap.io → sign up free');
        console.log('→ Inbox → SMTP Settings → copy credentials to .env');
        return;
    }

    console.log('\n📤 Sending test email to:', user);
    transport.sendMail({
        from: `"Grand Azure Hotel" <${user}>`,
        to: user,
        subject: '✅ Email Working - Grand Azure Hotel',
        html: `<div style="font-family:Arial;padding:20px;border:1px solid #ddd;border-radius:10px;max-width:500px">
            <h2 style="color:#0D1B2A">Email is Working! 🎉</h2>
            <p>Your hotel system email is configured correctly.</p>
        </div>`
    }, (err, info) => {
        if (err) {
            console.log('❌ Send failed:', err.message);
        } else {
            console.log('✅ SUCCESS! Email sent to your inbox!');
            console.log('   Check your Gmail now!');
        }
    });
}

run();
