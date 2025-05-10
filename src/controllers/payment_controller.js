import Stripe from 'stripe';
import dotenv from 'dotenv';

import MembershipModel from '../models/membership_model.js';
import UserModel from '../models/user_model.js';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createPaymentIntent(req, res) {
    const { firebase_id, membership } = req.body;

    const user = await UserModel.findOne({ firebase_id });
    if(!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    const membership_details = await MembershipModel.findOne({ name: membership });
    if(!membership_details) {
        return res.status(404).json({ message: 'Membership not found' });
    }

    const amount_cents = membership_details.cost * 100;
    const currency = 'usd';

    try {
        const intent = await stripe.paymentIntents.create({
            amount: amount_cents,                                              // cents
            currency: currency,
            automatic_payment_methods: { enabled: true },  
            metadata: {
                firebase_id: firebase_id,
                membership: membership
            }
        });
        res.json({ clientSecret: intent.client_secret });
    } catch (err) {
        console.error('Failed to create payment intent:', err);
        res.status(400).json({ error: err.message });
    }
}

export async function webhook(req, res) {
    console.log("Webhook received");
    const sig = req.headers["stripe-signature"];

    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Failed to construct event:', err);
        return res.status(400).send(`Webhook error: ${err.message}`);
    }

    const paymentIntent = event.data.object;
    const firebaseId = paymentIntent.metadata?.firebase_id;
    const membership = paymentIntent.metadata?.membership;

    const user = await UserModel.findOne({ firebase_id: firebaseId });

    if(!user) {
        console.error('User not found');
        return res.status(404).send('User not found');
    }

    const membership_details = await MembershipModel.findOne({ name: membership });
    if(!membership_details) {
        console.error('Membership not found');
        return res.status(404).send('Membership not found');
    }

    if (event.type === "payment_intent.succeeded") {
        console.log("Payment intent succeeded");
        user.membership = membership_details.name;
        user.credits += membership_details.credits;
        await user.save();
    }
    res.json({ received: true });
}