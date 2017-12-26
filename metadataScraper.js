
// ---------------- PARAMETERS --------------- //
// <channelID>: Slack channel ID to query for message history
// <oAuthToken>: Slack oAuth token issued to your app / bot for the Slack team
    // you must also allow the permissions scope "channels.history"
// [count]: number of messages to return in the query - default 100 messages
// [start]: beginning timestamp to query message history
    // use most recent metaData.latest for this parameter during daily queries
// [end]: ending timestamp to query message history - default to current time

const axios = require('axios');
const querystring = require('querystring');

async function metadataScraper(channel, token, start, end, count){
    const url = 'https://slack.com/api/channels.history';
    const request = { token, channel };

    if (count) request.count = count;
    else request.count = 1000;
    if (start) request.start = start;
    if (end) request.end = end;
    
    try {
        const { data } = await axios.post(url, querystring.stringify(request));
        if (!data.ok) {
            return data.error;
        }
        const metaDataOutput = parseMessages(data.messages);
        if (!metaDataOutput) {
            return reject('No messages to scan');
        }
        metaDataOutput.channel_id = channel;
        return metaDataOutput;
    } catch ({ message }) {
        console.error(new Error(message));
        return message;
    } 
}

function parseMessages(messages){
    const userMetadata = [];
    if (messages[0]) {
        messages.forEach( message => {
            let metaDataIndex;
        // user's metadata doesn't exist --> build their data object
            if(!userMetadata.some( (data, index) => { 
                if(data.user === message.user || 
                    data.user === message.bot_id || 
                    (message.comment && data.user === message.comment.user) 
                ){
                // if the user's metadata object is found then set the index for use in the else block
                    metaDataIndex = index;
                    return true 
                }  
            })) {
            // parse any available submetadata to build the user's metadata object
                let user;
                if(message.comment) user = message.comment.user;
                else user = message.bot_id || (message.comment && message.comment.user) || message.user ;
                userMetadata.push(parseSubMetadata(message, {user}));
            }

        // user's metadata exists --> modify their data object using metaDataIndex
            else userMetadata[metaDataIndex] = parseSubMetadata(message, userMetadata[metaDataIndex]);   
        });

        // set the timestamp field to be the most recent message in this query
        return { timestamp: messages[0].ts, user_metadata: userMetadata };
    } else return false;
}

function parseSubMetadata(message, data){
    const newMetadata = data;

    if(message.subtype) {
        // capture file metadata
         if(message.subtype === 'file_share') {
            if(!newMetadata.file_metadata) newMetadata.file_metadata = [];
            newMetadata.file_metadata.push(parseFileMetadata(message.file));
        }

        if(['reply_broadcast', 'thread_broadcast', 'channel_join', 'bot_message'].includes(message.subtype)){
            switch(message.subtype){
                case 'reply_broadcast':
                    if(!newMetadata.thread_comments) newMetadata.thread_comments = 1;
                    else newMetadata.thread_comments += 1;
                    break;
                case 'bot_message':
                // capture metadata of bot threads
                    if (message.thread_ts) {
                        if(!newMetadata.threads) newMetadata.threads = 1;
                        else newMetadata.threads += 1;

                        message.replies.forEach((reply) => {
                            if(reply.user !== message.bot_id){
                                if(!newMetadata.thread_replies) newMetadata.thread_replies = 1;
                                else newMetadata.thread_replies +=1;
                            }
                        });
                    }
                    break;
                default:
            }
        } else {
            if(!newMetadata[message.subtype]) newMetadata[message.subtype] = 1;
            else newMetadata[message.subtype]++;
        }   
    }

// capture message threads data
    if (message.thread_ts) {
        if(!message.root && !message.attachments){
        // capture thread replies on a user's thread
            if(message.replies){
                if(!newMetadata.threads) newMetadata.threads = 1;
                else newMetadata.threads += 1;

                message.replies.forEach((reply) => {
                    if(reply.user !== message.user){
                        if(!newMetadata.thread_replies) newMetadata.thread_replies = 1;
                        else newMetadata.thread_replies += 1;
                    }
                });
            } else {
            // capture user comments on threads
                if(!newMetadata.thread_comments) newMetadata.thread_comments = 1;
                else newMetadata.thread_comments += 1;
            }
        }
    }

// capture reactions
    if(message.reactions){
        if(!newMetadata.reactions) newMetadata.reactions = 0;
        message.reactions.forEach( reaction => newMetadata.reactions += reaction.count);
    }

// captures a comment being "starred" (saved for later in Slack)
    if (message.is_starred) {
        if(!newMetadata.is_starred) newMetadata.is_starred = true;
    }

// capture the number of times the message has been starred by other users
    if (message.num_stars) {
        if (!newMetadata.num_stars) newMetadata.num_stars = message.num_stars;
        else newMetadata.num_stars += message.num_stars;
    }

// capture original channel messages (prevent duplicates from thread-broadcasted messages )
    if (message.subtype !== 'thread_broadcast') {
        if(!newMetadata.messages) newMetadata.messages = 1;
        else newMetadata.messages += 1;
    }  

// if the user is a bot then give it a bot boolean property for identification downstream
    if(message.bot_id) newMetadata.bot = true;

    return newMetadata;
}

function parseFileMetadata(file){
    const file_metadata = {
        type: file.filetype,
        lines: file.lines
    };

    if(file.reactions){
        file_metadata.reactions = 0;
        file.reactions.forEach( reaction => file_metadata.reactions += reaction.count);
    }

    if(file.comments_count) file_metadata.comments_count = file.comments_count;

    if(file.num_stars) {
        file_metadata.is_starred = true;
        file_metadata.num_stars = file.num_stars;
    }

    return file_metadata;
}

module.exports = metadataScraper;
