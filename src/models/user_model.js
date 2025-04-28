import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    resumeFileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'resumes.files'
    }
});

const UserModel = mongoose.model('User', userSchema);

export default UserModel;