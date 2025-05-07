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
    credits: {
        type: Number,
        required: true,
        default: 0
    },
    membership: {
        type: String,
        required: true,
        default: 'free'
    }
});

const UserModel = mongoose.model('User', userSchema);

export default UserModel;