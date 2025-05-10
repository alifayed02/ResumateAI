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
            amount: amount_cents,
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

export async function createSubscriptionSession(req, res) {
    const { firebase_id, membership } = req.body;
  
    const user = await UserModel.findOne({ firebase_id });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
  
    const membership_details = await MembershipModel.findOne({ name: membership });
    if (!membership_details || !membership_details.stripe_price_id) {
      return res.status(404).json({ message: "Membership or Stripe Price ID not found" });
    }
  
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price: membership_details.stripe_price_id,
            quantity: 1,
          },
        ],
        metadata: {
          firebase_id: firebase_id,
          membership: membership,
        },
        success_url: "http://localhost:3000/profile",
        cancel_url: "http://localhost:3000/",
      });
  
      res.json({ sessionId: session.id });
    } catch (err) {
      console.error("Failed to create subscription session:", err);
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

    switch (event.type) {
        case "checkout.session.completed":
            await handleCheckoutSession(event, res);
            break;
    }

    res.json({ received: true });
}

// TODO: Rewrite this to handle one time credit payments
async function handlePaymentIntent(event, res) {
    const session = event.data.object;
    const firebaseId = session.metadata?.firebase_id;
    const membership = session.metadata?.membership;

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

    user.membership = membership_details.name;
    user.credits += membership_details.credits;
    await user.save();

    console.log("Payment intent handled");
}

async function handleCheckoutSession(event, res) {
    const session = event.data.object;
    const firebaseId = session.metadata.firebase_id;
    const membership = session.metadata.membership;

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

    user.membership = membership_details.name;
    user.credits += membership_details.credits;
    await user.save();

    console.log("Checkout session handled");
}