# Hostel Fund Management System - Complete Setup Guide

## 📱 Features

### Admin Features:
- ✅ Protected admin login
- ✅ Add/manage jobs with automatic 10%/90% distribution
- ✅ Add/manage students
- ✅ View all student balances in real-time
- ✅ Committee fund tracking
- ✅ Full dashboard with statistics
- ✅ Delete jobs (automatically reverses student balances)

### Student Features:
- ✅ Secure student login
- ✅ View personal balance in real-time
- ✅ Withdraw money (deducts from balance)
- ✅ View transaction history (earnings & withdrawals)
- ✅ Cannot see other students' data

### System Features:
- ✅ Cloud database (SQLite with online hosting option)
- ✅ JWT authentication
- ✅ Real-time balance updates
- ✅ Automatic money distribution
- ✅ Transaction tracking
- ✅ Mobile-responsive design

---

## 🚀 Quick Start

### Option 1: Run Locally (Testing)

#### Backend Setup:
```bash
cd backend
npm install
node server.js
```

Server will run on `http://localhost:3000`

Default admin login:
- Username: `admin`
- Password: `<REDACTED-legacy-default>`

#### Frontend Setup (Web Browser):
1. Open `frontend/App.jsx` in any React environment
2. Update API_URL to `http://localhost:3000/api`
3. Run your React app

---

## 🌐 Option 2: Deploy Online (Recommended for Production)

### Step 1: Deploy Backend to Cloud

#### Using Railway.app (FREE):
1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Upload your backend folder
5. Add environment variables:
   - `JWT_SECRET`: your-secure-random-string-here
6. Railway will give you a URL like: `https://your-app.railway.app`

#### Using Render.com (FREE):
1. Go to https://render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repo or upload backend
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Add environment variable:
   - `JWT_SECRET`: your-secure-random-string-here
7. Click "Create Web Service"
8. You'll get a URL like: `https://your-app.onrender.com`

#### Using Heroku:
1. Install Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli
2. Login: `heroku login`
3. Create app: `heroku create your-hostel-fund-app`
4. Deploy:
```bash
cd backend
git init
heroku git:remote -a your-hostel-fund-app
git add .
git commit -m "Deploy"
git push heroku master
```
5. Set environment: `heroku config:set JWT_SECRET=your-secret-here`

### Step 2: Update Frontend API URL
After deploying backend, update `frontend/App.jsx`:
```javascript
// Change this line:
const API_URL = 'http://YOUR_SERVER_IP:3000/api';

// To your deployed URL:
const API_URL = 'https://your-app.railway.app/api';
```

---

## 📱 Convert to Android APK

### Method 1: Using Expo (Easiest)

1. **Install Expo CLI:**
```bash
npm install -g expo-cli
```

2. **Create Expo Project:**
```bash
expo init HostelFundApp
cd HostelFundApp
```

3. **Replace App.js with our App.jsx code**

4. **Install dependencies:**
```bash
npm install lucide-react-native
```

5. **Update for React Native:**
Replace all `localStorage` with `AsyncStorage`:
```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace localStorage.setItem with:
await AsyncStorage.setItem('token', data.token);

// Replace localStorage.getItem with:
const token = await AsyncStorage.getItem('token');
```

6. **Build APK:**
```bash
expo build:android
```

Follow prompts. After build completes, download APK from Expo.

### Method 2: Using React Native CLI

1. **Setup React Native:**
```bash
npx react-native init HostelFundApp
cd HostelFundApp
```

2. **Install dependencies:**
```bash
npm install @react-navigation/native
npm install react-native-vector-icons
npm install @react-native-async-storage/async-storage
```

3. **Replace App.js with our code (modified for React Native)**

4. **Build APK:**
```bash
cd android
./gradlew assembleRelease
```

APK will be in: `android/app/build/outputs/apk/release/app-release.apk`

### Method 3: Using Capacitor (Web to Mobile)

1. **Install Capacitor:**
```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/android
npx cap add android
```

2. **Build web version:**
```bash
npm run build
```

3. **Copy to Android:**
```bash
npx cap copy android
npx cap open android
```

4. **Build in Android Studio:**
- Build → Generate Signed Bundle / APK
- Select APK
- Choose release
- Create keystore (first time)
- Build APK

---

## 🔐 Security Setup (IMPORTANT!)

### 1. Change Default Admin Password:
After first login, admin should change password:
```javascript
// Add this endpoint to backend or change in database
POST /api/auth/change-password
{
  "oldPassword": "<REDACTED-legacy-default>",
  "newPassword": "your-new-secure-password"
}
```

### 2. Secure JWT Secret:
Generate a strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Update in your hosting environment variables.

### 3. Enable HTTPS:
Most hosting platforms (Railway, Render, Heroku) automatically provide HTTPS.

---

## 📊 Database Management

### View Database:
```bash
cd backend
sqlite3 hostel_fund.db
```

```sql
-- View all students
SELECT * FROM users WHERE role='student';

-- View all balances
SELECT u.full_name, sb.balance 
FROM users u 
JOIN student_balances sb ON u.id = sb.student_id;

-- View transactions
SELECT * FROM transactions ORDER BY created_at DESC LIMIT 10;

-- View committee fund
SELECT * FROM committee_fund;
```

### Backup Database:
```bash
cp hostel_fund.db hostel_fund_backup_$(date +%Y%m%d).db
```

### Reset Database:
```bash
rm hostel_fund.db
node server.js  # Will recreate with default admin
```

---

## 🎯 Usage Guide

### For Admin:

1. **Login** with admin credentials
2. **Add Students**: Click "Add Student" → Enter details → Each student gets login
3. **Add Jobs**: Click "Add Job" → Enter job name, amount, date
   - 10% automatically goes to committee fund
   - 90% is distributed equally to all students
4. **Monitor**: View dashboard for statistics
5. **Manage**: Delete jobs or students as needed

### For Students:

1. **Login** with credentials given by admin
2. **View Balance**: See your current balance on dashboard
3. **Check Transactions**: View all earnings and withdrawals
4. **Withdraw Money**: Click "Withdraw" → Enter amount → Confirm
   - Balance updates immediately
   - Transaction is recorded

---

## 🛠️ Troubleshooting

### Backend won't start:
```bash
# Check if port 3000 is in use
lsof -i :3000
# Kill process: kill -9 <PID>

# Or use different port:
PORT=5000 node server.js
```

### CORS errors:
Update backend server.js:
```javascript
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-frontend-domain.com'],
  credentials: true
}));
```

### Can't login:
- Check if backend is running
- Verify API_URL in frontend is correct
- Check browser console for errors
- Try default credentials: admin/<REDACTED-legacy-default>

### APK not installing:
- Enable "Install from Unknown Sources" in Android settings
- Build signed release APK (not debug)
- Check Android version compatibility

---

## 📱 APK Installation on Android

1. **Transfer APK to phone** (via USB, email, or cloud)
2. **Enable Unknown Sources**:
   - Settings → Security → Unknown Sources → Enable
   - Or: Settings → Apps → Special Access → Install Unknown Apps
3. **Install APK**: Tap the file and click Install
4. **Open App**: Find "Hostel Fund" in app drawer

---

## 🔄 Updates & Maintenance

### Update Backend:
1. Make changes to server.js
2. Commit and push to hosting platform
3. Platform will auto-deploy

### Update Frontend/APK:
1. Update App.jsx
2. Rebuild APK using same method
3. Uninstall old app
4. Install new APK
5. (Or publish to Play Store for auto-updates)

---

## 📈 Scaling & Advanced Features

### Add SMS Notifications:
```bash
npm install twilio
```

### Add Email Reports:
```bash
npm install nodemailer
```

### Switch to PostgreSQL (for larger scale):
```bash
npm install pg
# Update database connection in server.js
```

### Add Admin Dashboard Charts:
Already have backend data - just need to integrate Chart.js in frontend

---

## 💡 Tips

1. **Regular Backups**: Backup database weekly
2. **Student IDs**: Use roll numbers as usernames
3. **Committee Fund**: Can withdraw from committee fund via SQL if needed
4. **Testing**: Test on local before deploying
5. **Play Store**: For wider distribution, publish on Google Play Store

---

## 🆘 Support

### Common Issues:

**"Cannot connect to server"**
→ Check if backend is running and API_URL is correct

**"Invalid credentials"**
→ Verify username/password, check database users table

**"Insufficient balance"**
→ Student needs to wait for jobs to be added by admin

**"Token expired"**
→ Re-login (tokens expire after 7 days)

---

## 📝 Notes

- Database file: `backend/hostel_fund.db`
- JWT tokens valid for 7 days
- All amounts in Indian Rupees (₹)
- Transactions are permanent (cannot be undone)
- Admin can delete jobs (reverses balances)
- Students cannot see other students' balances
- Committee fund tracks 10% of all jobs

---

## 🎓 Example Workflow

1. Admin creates account for 10 students
2. Admin adds job: "Hostel Cleaning - ₹1000"
   - Committee gets: ₹100
   - Each student gets: ₹90 (900÷10)
3. Student logs in, sees ₹90 balance
4. Student withdraws ₹50
   - New balance: ₹40
5. Admin adds another job: "Event Management - ₹2000"
   - Committee gets: ₹100 more (total ₹200)
   - Each student gets: ₹180 more
   - Student's balance: ₹220 (₹40 + ₹180)

---

## ✅ Checklist Before Going Live

- [ ] Backend deployed and accessible online
- [ ] Database backed up
- [ ] Default admin password changed
- [ ] JWT_SECRET set to random secure value
- [ ] API_URL updated in frontend
- [ ] Tested admin login
- [ ] Tested student login
- [ ] Tested job creation
- [ ] Tested withdrawal
- [ ] APK built and tested on Android device
- [ ] Instructions given to all students

---

**Your hostel fund management system is ready! 🎉**

For questions or issues, check the troubleshooting section or contact your system administrator.
