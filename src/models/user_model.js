import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    resumeFileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'resumes.files'
    }
});

const UserModel = mongoose.model('User', userSchema);

export default UserModel;