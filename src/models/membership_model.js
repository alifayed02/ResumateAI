import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    cost: {
        type: Number,
        required: true
    },
    credits: {
        type: Number,
        required: true
    },
    stripe_price_id: {
        type: String,
        required: true
    }
});

const MembershipModel = mongoose.model('Membership', subscriptionSchema);

export default MembershipModel;