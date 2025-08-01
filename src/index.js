import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoute from './routes/auth.js';
import cvReaderRoute from './routes/cv_reader.js';
import cvEnhancerRoute from './routes/cv_enchancer.js';
import SearchRoute from './routes/search.js'
import db from './lib/dbConnect.js';
dotenv.config();



const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());


// Routes
app.use('/api/auth', authRoute);
app.use('/api/cv_reader', cvReaderRoute);
app.use('/api/cv_enhancer', cvEnhancerRoute);
app.use('/api/search', SearchRoute);


async function startServer() {
  try {
    await db.getConnection().then(conn => {
      conn.release(); 
      console.log('✅ MySQL connected successfully.');
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to connect to MySQL:', error.message);
    process.exit(1); 
  }
}
startServer();

