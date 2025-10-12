const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'alive', 
    time: new Date().toISOString() 
  });
});

module.exports = router;