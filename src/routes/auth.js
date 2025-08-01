import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import db from '../lib/dbConnect.js';
import { Router } from 'express';
import dotenv from 'dotenv';

dotenv.config();
const router = Router();

const API_URL = process.env.API_URL

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE
    });
};

const generateVerificationToken = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const sendVerificationEmail = async (email, token) => {
    const verificationUrl = `${API_URL}/api/auth/verify-email?token=${token}`;
    
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Verify Your Email',
        html: `
            <h1>Email Verification</h1>
            <p>Click the link below to verify your email:</p>
            <a href="${verificationUrl}">Verify Email</a>
        `
    };
    
    await transporter.sendMail(mailOptions);
};

router.post('/register', async (req, res) => {
    try {
        const {  email, password } = req.body;
        
        if (  !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (results.length > 0) {
                return res.status(400).json({ error: 'User already exists' });
            }
            
            try {
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                
                const verificationToken = generateVerificationToken();
                
                db.query(
                    'INSERT INTO users ( email, password, verification_token) VALUES ( ?, ?, ?)',
                    [ email, hashedPassword, verificationToken],
                    async (err, result) => {
                        if (err) {
                            return res.status(500).json({ error: 'Failed to create user' });
                        }
                        
                        try {
                            await sendVerificationEmail(email, verificationToken);
                        } catch (emailErr) {
                            console.error('Email sending failed:', emailErr);
                        }
                        
                        res.status(201).json({
                            message: 'User registered successfully. Please check your email to verify your account.',
                            userId: result.insertId
                        });
                    }
                );
            } catch (hashError) {
                return res.status(500).json({ error: 'Password hashing failed' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (results.length === 0) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }
            
            const user = results[0];
            
            if (!user.is_verified) {
                return res.status(400).json({ error: 'Please verify your email first' });
            }
            
            const isPasswordValid = await bcrypt.compare(password, user.password);
            
            if (!isPasswordValid) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }
            
            const token = generateToken(user.id);
            
            res.json({
                message: 'Login successful',
                token,
                user: {
                    id: user.id,
                    email: user.email
                }
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/verify-email', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).json({ error: 'Verification token required' });
    }
    
    db.query('SELECT * FROM users WHERE verification_token = ?', [token], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (results.length === 0) {
            return res.status(400).json({ error: 'Invalid verification token' });
        }
        
        db.query(
            'UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE verification_token = ?',
            [token],
            (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to verify email' });
                }
                
                res.json({ message: 'Email verified successfully' });
            }
        );
    });
});



export default router;