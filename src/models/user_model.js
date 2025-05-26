import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    firebase_id: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    resumeFileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'resumes.files'
    },
    optimizedResumeFileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'optimized_resumes.files'
    },
    credits: {
        type: Number,
        required: true,
        default: 0
    },
    membership: {
        type: String,
        required: true,
        default: 'free'
    },
    subscription: {
        type: String,
        required: true,
        default: 'inactive'
    },
    stripe_subscription_id: {
        type: String,
        required: false,
        default: ''
    },
    subscription_end: {
        type: Date,
        required: false,
        default: null
    }
});

const UserModel = mongoose.model('User', userSchema);

export default UserModel;