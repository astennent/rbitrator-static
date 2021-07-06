var express = require("express");
var logfmt = require("logfmt");
var app = express();

app.use(logfmt.requestLogger());

var port = Number(process.env.PORT || 5000);
app.use(function(req, res, next) {
   res.setHeader('Access-Control-Allow-Origin', '*');
   next();
});
app.use(express.static('.'));
app.listen(port, function() {
   console.log("Listening on " + port);
});
