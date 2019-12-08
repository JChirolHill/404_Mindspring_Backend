const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const app = express();
const cors = require('cors');

const { ENVIRONMENT, PORT, QUOTE_API_KEY } = process.env;
const IS_DEVELOPMENT = ENVIRONMENT === 'development';

// HELPER FUNCTIONS
const IMAGE_API_URL = 'https://picsum.photos/v2/list';
const QUOTE_API_URL = 'https://favqs.com/api/quotes';
const categories = ['picture', 'quote'];
const fetch = require("node-fetch");

async function fetchImages() {
  let randPage = parseInt(Math.random() * 30);
  console.log(`${IMAGE_API_URL}?page=${randPage}`);
  let response = await fetch(`${IMAGE_API_URL}?page=${randPage}`);
  return response.json();
}

async function fetchQuotes() {
  let response = await fetch(QUOTE_API_URL, {
    headers:  {
      'Authorization': `Token token="${QUOTE_API_KEY}"`
    }
  });
  return response.json();
}

app.use(express.json());

app.use(cors({
  origin: IS_DEVELOPMENT ? 'http://localhost:3000' : 'https://mindspring.surge.sh'
}));

// TEMPORARY GAME STORAGE
const groupCodes = [];
const tempStorage = {};

// GAME HANDLING

// get valid group code not currently in use
app.get('/group_code', (request, response) => {
  // randomly generate random number
  let validCode = true;
  let rand;
  do {
    rand = parseInt(Math.random() * (9999 - 1000) + 1000);

    // check no other group has this code
    for(var code of groupCodes) {
      if(rand === code) {
        validCode = false;
        break;
      }
    }
  } while(!validCode);

  groupCodes.push(rand);
  response.json({
    code: rand
  });
});

// create a new game
app.post('/create_game', (request, response) => {
  const body = request.body;
  if(body.code && body.numPlayers && body.numQs) {
    tempStorage[body.code] = {
      users: [],
      numPlayers: body.numPlayers,
      numComplete: 0,
      numQs: body.numQs
    }
    response.json(tempStorage[body.code]);
  }
  else {
    response.status(406).send({ message: "Malformed request." });
  }
});

// add user to existing game
app.put('/add_user', (request, response) => {
  const body = request.body;
  const game = tempStorage[body.code];
  if(game) {
    if(game.users.length < game.numPlayers) {
      if(game.users.includes(body.username)) {
        response.status(406).send({
          errorType: "user",
          message: "User already exists with this name."
        });
      }
      else {
        game.users.push(body.username);
        response.json(game);
      }
    }
    else {
      response.status(406).send({
        errorType: "game",
        message: "Group has reached maximum players."
      });
    }
  }
  else {
    response.status(404).send({
      errorType: "code",
      message: `Invalid group code`
    });
  }
});

// get number of players in a game
app.get('/num_players/:code', (request, response) => {
  const code = Number(request.params.code);
  const game = tempStorage[code];
  if(game) {
    response.json({
      curr_num_players: game.users.length,
      total_players: game.numPlayers
    });
  }
  else {
    response.status(404).send({ message: `Game with group code ${code} does not exist.`})
  }
});

// get number of players who already submitted their responses
app.get('/num_players_done/:code', (request, response) => {
  const code = Number(request.params.code);
  const game = tempStorage[code];
  if(game) {
    response.json({
      curr_num_players_done: game.numComplete,
      total_players: game.numPlayers
    });
  }
  else {
    response.status(404).send({ message: `Game with group code ${code} does not exist.`})
  }
});

// get next prompt for group game
app.post('/prompts', (request, response) => {
  console.log(`request to prompts for game ${request.body.code}`);
  const solo = request.body.solo;
  if(solo === undefined) {
    response.status(404).send({ message: `Missing parameters.`});
    return;
  }

  // check for missing parameters and get values
  let game;
  if(solo) {
    if(!request.body.numQs) {
      response.status(404).send({ message: `Missing parameters.`});
      return;
    }
  }
  else {
    if(!request.body.code) {
      response.status(404).send({ message: `Missing parameters.`});
      return;
    }
    const code = Number(request.body.code);
    game = tempStorage[code];
    if(!game) {
      response.status(404).send({ message: `Game with group code ${code} does not exist or does not have a number of questions specified.`})
      return;
    }
  }
  const numQs = (solo ? request.body.numQs : game.numQs);

  if(solo || (!solo && game && game.numQs)) {
    if(!solo && game.prompts) { // return prompts
      // not yet loaded all prompts, wait a tiny bit
      while(game.prompts === []) {
        setTimeout(() => {}, 100);
      }
      response.json(game.prompts);
    }
    else if(solo || (!solo && !game.prompts)) { // generate prompts
      if(!solo) {
        game.prompts = [];
      }
      const prompts = [];

      // fetch the prompts from apis
      Promise.all([
        fetchImages(),
        fetchQuotes()
      ]).then((result) => {
        const [fetchedImages, fetchedQuotes] = result;
        quotes = fetchedQuotes.quotes;

        for(let i=0; i<numQs; ++i) { // generate all prompts
          prompts[i] = [];

          for(let j=0; j<2; ++j) { // generate each prompt
            let rand = parseInt(Math.random() * categories.length);
            let prompt = {};
            switch(rand) {
              case 0: // picture
                if(fetchedImages.length > 0) {
                  prompt = {
                    type: categories[rand],
                    url: fetchedImages.pop().download_url
                  }
                }
                break;
              case 1: // quote
                if(quotes.length > 0) {
                  prompt = {
                    type: categories[rand],
                    author: quotes.pop().author,
                    quote: quotes.pop().body
                  }
                }
                break;
            }

            // push placeholder for similarities
            prompts[i].push(prompt);
          }
          prompts[i].push([]);
        }
        if(!solo) {
          game.prompts = prompts;
        }
        response.json(prompts);
      });
    }
  }
});

app.get('/similarities/:code', (request, response) => {
  const code = Number(request.params.code);
  const game = tempStorage[code];
  if(game) {
    response.json(game.prompts);
  }
  else {
    response.status(404).send({ message: `Game with group code ${code} does not exist.`})
  }
});

// push up similarities from a particular user
app.put('/similarities', (request, response) => {
  // check all params
  if(!request.body.code || !request.body.similarities || !request.body.username) {
    response.status(404).send({ message: `Missing parameters.` });
    return;
  }

  // add similarities
  const game = tempStorage[request.body.code];
  if(game && game.numComplete < game.numPlayers) {
    const player = game.users.includes(request.body.username);
    if(player) {
      request.body.similarities = request.body.similarities.reverse();
      for(let i=0; i<request.body.similarities.length; ++i) {
        if(request.body.similarities[i][0].type === game.prompts[i][0].type
          && request.body.similarities[i][1].type === game.prompts[i][1].type) {
          game.prompts[i][2].push({
            username: request.body.username,
            similarity: request.body.similarities[i][2][0].similarity
          });
        }
      }
      game.numComplete = game.numComplete + 1;
      response.status(204).send();
    }
    else {
      response.status(404).send({ message: 'Invalid username for this game.' });
    }
  }
  else {
    response.status(404).send({ message: `Invalid group code ${request.body.code} or all players have already submitted.` });
  }
});

app.get('/FULLDISCLOSURE', (request, response) => {
  response.json(tempStorage);
});

// BEST OF HANDLING

app.listen(process.env.PORT || 8000);
