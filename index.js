//const characters ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const fs = require('fs');
const csv = require('csv-parser');
var express = require('express');
var multer = require('multer');
require('dotenv').config()
var upload = multer();
var path = require('path');
var app = express();
var PORT = 8888;

app.use(express.static(__dirname + '/public'));

//spotify
var SpotifyWebApi = require('spotify-web-api-node');
const { count } = require('console');

var scopes = ['user-top-read']
//var state = generateString(16);
var credentials = {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
  };
  
var spotifyApi = new SpotifyWebApi(credentials);

app.get('/', function(req, res){
    res.sendFile(path.join(__dirname, '/public/login.html'));
});

app.get('/login', async function(req, res){
    res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

app.get('/callback', function(req, res){
    // Retrieve an access token and a refresh token
    spotifyApi.authorizationCodeGrant(req.query.code).then(
        function(data) {
        res.redirect('/results/?access_token=' + data.body['access_token'] + '&refresh_token=' + data.body['refresh_token']);
        },
        function(err) {
        res.send('Something went wrong! ' + err);
        }
    );
});

app.get('/results', async function(req, res){
    try {
        var userSpotifyApi = new SpotifyWebApi();

        userSpotifyApi.setAccessToken(req.query.access_token);
        userSpotifyApi.setRefreshToken(req.query.refresh_token);

        //get user
        const nameData = await userSpotifyApi.getMe()

        //get top tracks and their artists
        const data = await userSpotifyApi.getMyTopTracks({limit: 15, time_range: 'medium_term'});
        var ids = [];
        var artistids = [];
        for (let item of data.body.items) {
            //console.log(item.name)
            //console.log(item.artists[0].id)
            ids.push(item.id);
            artistids.push(item.artists[0].id)
        }
        const features = await userSpotifyApi.getAudioFeaturesForTracks(ids);


        //set most liked genre based off of top 15 songs
        const artists = await userSpotifyApi.getArtists(artistids)
        //console.log(artists.body.artists[0].genres)
        var topgenres = []
        artists.body.artists.forEach(artist=>{
            topgenres.push(artist.genres[0])
        })
        //console.log(topgenres)

        //count top genres by occurrences
        const occurrences = topgenres.reduce(function (acc, curr) {
            return acc[curr] ? ++acc[curr] : acc[curr] = 1, acc
          }, {});

        //console.log(nameData.body.display_name + ": " + topgenres)

        var favoriteGenre = ''
        var highestNum = 0
        for (genre in occurrences) {
            if (occurrences[genre] > highestNum) {
                highestNum = occurrences[genre]
                favoriteGenre = genre
            }
        }
        if (highestNum == 1) {
            favoriteGenre = topgenres[0]
        }

        //console.log(favoriteGenre)


        //get top 100 most streamed songs to weigh thresholds
        const mostStreamedTracks = await userSpotifyApi.getPlaylistTracks('5ABHKGoOzxkaa28ttQV9sE')
        ids = [];
        for (let item of mostStreamedTracks.body.items) {
            //console.log(item.name + " " + item.id)
            ids.push(item.track.id);
        }
        const mostStreamedFeatures = await userSpotifyApi.getAudioFeaturesForTracks(ids);

        //calculate personality types
        var moods = calcMoods(features.body.audio_features, mostStreamedFeatures.body.audio_features)

        //log to server
        console.log(nameData.body.display_name + ' viewed their results')

        //log result
        fs.appendFile("types.csv", moods[0] + "," + nameData.body.id + ',' + favoriteGenre/*+ ',' + req.body.time_range*/ + "\r\n", (err) => {
            if (err) {
                console.log(err);
            }
        });

        var chartData = await getData();
        //console.log(chartData)

        res.render('results.ejs', {userResults: moods, displayName: nameData.body.display_name, chartData: chartData, favoriteGenre: favoriteGenre/*, time_range: req.body.time_range*/});

    } catch(err) {
        const nameData = await userSpotifyApi.getMe()
        console.log(nameData.body.display_name + ' got an error: ' + err)
        res.send('An error has occured: ' + err)
    }
    
});

// for parsing application/json
app.use(express.json()); 

// for parsing application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true })); 

// for parsing multipart/form-data
app.use(upload.array()); 
  
app.listen(PORT, function(err){
    if (err) console.log(err);
    console.log("Server listening on PORT", PORT);
});

//generate spotify state
/*function generateString(length) {
    let result = ' ';
    const charactersLength = characters.length;
    for ( let i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }

    return result;
}*/

function calcMoods(features, mostStreamedFeatures) {
    var types = {
        'instrumentalness (are there spoken words in your top 15 songs or no)': {
            instrumental: 0,
            articulate: 0
        },
        'valence (are your top 15 songs happy or no)': {
            joyful: 0,
            melancholy: 0
        },
        'energy (are your top 15 songs energetic or no)': {
            lively: 0,
            chill: 0
        },
        'danceability (do your top 15 songs have consistent enough beat to dance to or no)': {
            rhythmic: 0,
            free: 0
        }
    };

    var totalInstrumentalness = []
    var totalValence = []
    var totalEnergy = []
    var totalDanceability = []

    mostStreamedFeatures.forEach(song=>{
        totalInstrumentalness.push(song.instrumentalness);
        totalValence.push(song.valence);
        totalEnergy.push(song.energy);
        totalDanceability.push(song.danceability);
    })

    var mostStreamedInstrumentalness = average(totalInstrumentalness);
    var mostStreamedValence = average(totalValence);
    var mostStreamedEnergy = average(totalEnergy);
    var mostStreamedDance = average(totalDanceability);

    //console.log('mostStreamedInstrumentalness' + mostStreamedInstrumentalness)
    //console.log('mostStreamedValence' + mostStreamedValence)
    //console.log('mostStreamedEnergy' + mostStreamedEnergy)
    //console.log('mostStreamedDance' + mostStreamedDance)

    //separate features
    totalInstrumentalness = []
    totalValence = []
    totalEnergy = []
    totalDanceability = []

    features.forEach(song=>{
        totalInstrumentalness.push(song.instrumentalness);
        totalValence.push(song.valence);
        totalEnergy.push(song.energy);
        totalDanceability.push(song.danceability);
    })

    var thresholds = {
        'instrumentalness (are there spoken words in your top 15 songs or no)': {
            instrumental: {low: mostStreamedInstrumentalness-.000001, high: 1},
            articulate: {low: -.000001, high: mostStreamedInstrumentalness-.000001}
        },
        'valence (are your top 15 songs happy or no)': {
            joyful: {low: mostStreamedValence-.000001, high: 1},
            melancholy: {low: -.000001, high: mostStreamedValence-.000001}
        },
        'energy (are your top 15 songs energetic or no)': {
            lively: {low: mostStreamedEnergy-.000001, high: 1},
            chill: {low: -.000001, high: mostStreamedEnergy-.000001}
        },
        'danceability (do your top 15 songs have consistent enough beat to dance to or no)': {
            rhythmic: {low: mostStreamedDance-.000001, high: 1},
            free: {low: -.000001, high: mostStreamedDance-.000001}
        }
    };

    var totals = {
        'instrumentalness (are there spoken words in your top 15 songs or no)': totalInstrumentalness,
        'valence (are your top 15 songs happy or no)': totalValence,
        'energy (are your top 15 songs energetic or no)': totalEnergy,
        'danceability (do your top 15 songs have consistent enough beat to dance to or no)': totalDanceability
    }

    //calc points
    for (var feature in totals) {
        for (var val in totals[feature]) {
            for (var type in thresholds[feature]) {
                if (totals[feature][val] > thresholds[feature][type].low && totals[feature][val] <= thresholds[feature][type].high) {
                    types[feature][type]+=1;
                }
            }
        }
    }

    var type = ''
    var typefull = []

    ////////////////instrumentalness
    var hic = 0
    var loc = 0
    totalInstrumentalness.forEach(val=>{
        if (val > mostStreamedInstrumentalness) {
            hic++
        } else {
            loc++
        }
    })
    if (hic > loc) {
        type += 'I'
        typefull.push('instrumental')
    } else {
        type += 'A'
        typefull.push('articulate')
    }

    ////////////////////////valence
    hic = 0
    loc = 0
    totalValence.forEach(val=>{
        if (val > mostStreamedValence) {
            hic++
        } else {
            loc++
        }
    })
    if (hic > loc) {
        type += 'J'
        typefull.push('joyful')
    } else {
        type += 'M'
        typefull.push('melancholy')
    }

    ///////////////////////////energy
    hic = 0
    loc = 0
    totalEnergy.forEach(val=>{
        if (val > mostStreamedEnergy) {
            hic++
        } else {
            loc++
        }
    })
    if (hic > loc) {
        type += 'L'
        typefull.push('lively')
    } else {
        type += 'C'
        typefull.push('chill')
    }

    ///////////////////////////danceability
    hic = 0
    loc = 0
    totalDanceability.forEach(val=>{
        if (val > mostStreamedDance) {
            hic++
        } else {
            loc++
        }
    })
    if (hic > loc) {
        type += 'R'
        typefull.push('rhythmic')
    } else {
        type += 'F'
        typefull.push('free')
    }

    //console.log(type)
    //console.log(typefull)

    //return types;
    return [type, typefull, types]
}

function removeDuplicates(a) {
    var seen = {};
    return a.filter(function(item) {
        return seen.hasOwnProperty(item) ? false : (seen[item] = true);
    });
}

function getData() {
    let results = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream('types.csv')
        .on('error', error => {
            reject(error);
        })
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            results = [...new Map(results.map(v => [JSON.stringify([v.type,v.id]), v])).values()]
            var types = ['AJCF','AJCR','AJLF','AJLR','AMCF','AMCR','AMLF','AMLR','IJCF','IJCR','IJLF','IJLR','IMCF','IMCR','IMLF','IMLR']
            var typeCounts = []
            var typesGenres = [
                {'AJCF': []},
                {'AJCR': []},
                {'AJLF': []},
                {'AJLR': []},
                {'AMCF': []},
                {'AMCR': []},
                {'AMLF': []},
                {'AMLR': []},
                {'IJCF': []},
                {'IJCR': []},
                {'IJLF': []},
                {'IJLR': []},
                {'IMCF': []},
                {'IMCR': []},
                {'IMLF': []},
                {'IMLR': []}
            ]

            types.forEach((type,i)=>{
                var typecount = 0
                results.forEach(entry=>{
                    if (entry.type == type) {
                        typecount++
                        var dupe = false
                        typesGenres[i][type].forEach(genre=>{
                            if (genre == entry.genre) {
                                dupe = true
                            }
                        })
                        if (!dupe) {
                            typesGenres[i][type].push(entry.genre)
                        }
                        
                    }
                })
                typeCounts.push(typecount)
            })

            var typesGenresClean = []
            //removing non values
            types.forEach((type,i)=>{
                //console.log(typesGenres[i][type].length)
                if (typesGenres[i][type].length > 0) {
                    //typesGenres.splice(i,1)
                    //i--
                    //console.log('blah')
                    typesGenresClean.push({
                        [type]: typesGenres[i][type]
                    })
                }
            })

            //console.log(typesGenresClean)


            for(var i=0; i<typeCounts.length;i++ ) { 
                if(typeCounts[i] == 0) {
                    typeCounts.splice(i,1)
                    types.splice(i,1)
                    i--
                }
            } 

            types = types.filter(function(val){
                return val !== ''
            });

            resolve([results, types, typeCounts, typesGenresClean])
            // [
            //   { NAME: 'Daffy Duck', AGE: '24' },
            //   { NAME: 'Bugs Bunny', AGE: '22' }
            // ]
        });
    });

    // dataPromise.then(
    //     function(cleanedData) {
    //         var types = ['ABCF','ABCR','ABLF','ABLR','AMCF','AMCR','AMLF','AMLR','IBCF','IBCR','IBLF','IBLR','IMCF','IMCR','IMLF','IMLR']
    //         var typeCounts = []

    //         types.forEach(type=>{
    //             var typecount = 0
    //             cleanedData.forEach(entry=>{
    //                 if (entry.type == type) {
    //                     typecount++
    //                 }
    //             })
    //             typeCounts.push(typecount)
    //         })

    //         //console.log([cleanedData, types, typeCounts])

    //         return [cleanedData, types, typeCounts]
    //     },
    //     function(error) { console.log(error) }
    // );

    
    
}


const average = arr => arr.reduce((a,b) => a + b, 0) / arr.length;

