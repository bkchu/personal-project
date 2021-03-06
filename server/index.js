require('dotenv').config();
const express = require('express');
const { json } = require('body-parser');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const Auth0Strategy = require('passport-auth0');
const massive = require('massive');

// controllers
const userCtrl = require('./controllers/userController');
const postCtrl = require('./controllers/postController');
const followCtrl = require('./controllers/followController');
const likeCtrl = require('./controllers/likeController');
const commentCtrl = require('./controllers/commentController');

const app = express();

app.use(express.static(path.join(__dirname, '../build')));

app.use(json());
app.use(cors());

massive(process.env.CONNECTION_STRING).then(db => {
  app.set('db', db);
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 2 * 7 * 24 * 60 * 60 * 1000
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(
  '/s3',
  require('react-s3-uploader/s3router')({
    bucket: 'react-journal-user-profile',
    region: 'us-east-2', //optional
    signatureVersion: 'v4', //optional (use for some amazon regions: frankfurt and others)
    headers: { 'Access-Control-Allow-Origin': '*' }, // optional
    ACL: 'private', // this is default
    uniquePrefix: true // (4.0.2 and above) default is true, setting the attribute to false preserves the original filename in S3
  })
);

passport.use(
  new Auth0Strategy(
    {
      domain: process.env.DOMAIN,
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: '/auth',
      scope: 'openid email profile'
    },
    (accessToken, refreshToken, extraParams, profile, done) => {
      app
        .get('db')
        .getUserByEmail([profile.emails[0].value])
        .then(response => {
          if (!response[0]) {
            app
              .get('db')
              .addUser([
                profile.id,
                profile.emails[0].value,
                profile.nickname,
                profile._json.email_verified
              ])
              .then(response => done(null, response[0]))
              .catch(err => console.log(err));
          } else {
            app
              .get('db')
              .updateVerificationStatus([
                profile.emails[0].value,
                profile._json.email_verified
              ])
              .then(res => {
                return done(null, response[0]);
              })
              .catch(err => console.log(err));
          }
        });
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((user, done) => {
  done(null, user);
});

// auth endpoints
app.get(
  '/auth',
  passport.authenticate('auth0', {
    successRedirect: process.env.CLIENT_HOST + 'profile/new',
    failureRedirect: '/auth',
    failureFlash: true
  })
);
app.get('/api/logout', userCtrl.logoutUser);

// user endpoints
app.get('/api/user', userCtrl.getUser);
app.get('/api/users', authenticated, userCtrl.getUsers);
app.get('/api/users/follows', authenticated, userCtrl.getUsersFollows);
app.get('/api/users/:userid/profile', authenticated, userCtrl.getUserProfile);
app.get('/api/users/isnew', authenticated, userCtrl.setUserIsNewToFalse);
app.post('/api/users/profile/new', authenticated, userCtrl.addProfile);
app.put('/api/users/profile/edit', authenticated, userCtrl.updateProfile);

//posts endpoints TODO: add authenticated as middleware
app.get('/api/posts', authenticated, postCtrl.getPosts);
app.get('/api/users/:userid/posts', authenticated, postCtrl.getPostsByUserId);
app.get('/api/posts/count', authenticated, postCtrl.getPostsCount);
app.get(
  '/api/users/:userid/posts/count',
  authenticated,
  postCtrl.getPostsByUserIdCount
);
app.get('/api/posts/:id', authenticated, postCtrl.getPost);
app.post('/api/posts', authenticated, postCtrl.addPost);
app.delete('/api/posts/:id', authenticated, postCtrl.deletePost);
app.put('/api/posts/:id', authenticated, postCtrl.updatePost);

// follows endpoints
app.post('/api/follows/:authid', authenticated, followCtrl.addFollow);
app.get('/api/follows', authenticated, followCtrl.getFollows);
app.delete('/api/follows/:authid', authenticated, followCtrl.removeFollow);

// likes endpoints
app.post('/api/likes/:postid', authenticated, likeCtrl.addLike);
app.delete('/api/likes/:postid', authenticated, likeCtrl.removeLike);

// comments endpoints
app.get('/api/posts/:id/comments', authenticated, commentCtrl.getComments);
app.post('/api/posts/:id/comments', authenticated, commentCtrl.addComment);
app.put('/api/comments/:id', authenticated, commentCtrl.updateComment);
app.delete('/api/comments/:id', authenticated, commentCtrl.deleteComment);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../build/index.html'));
});

// check if authenticated - request-level middleware
function authenticated(req, res, next) {
  if (req.user && req.user.email_verified) {
    next();
  } else if (!req.user) {
    res.status(403).json({ error: 'Please log in.' });
  } else {
    res.status(401).json({ error: 'Please verify your email and try again.' });
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Listening on port: ${PORT}`);
});
