-- How the shopper actually paid inside Razorpay (upi, card, netbanking, wallet, emi…), shown on the order.
ALTER TABLE payments ADD COLUMN instrument TEXT;
