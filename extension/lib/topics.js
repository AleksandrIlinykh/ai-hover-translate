const MAX_TEXT = 1500;
const MAX_TOPICS = 5;
const MAX_TOPIC_LENGTH = 30;
const EDGE_JUNK = /^[\s#"'*•.-]+|[\s"'*.]+$/g;

// A small request for the page topic, asked once per page from a long text.
export function buildTopicMessages(text) {
  return [
    {
      role: 'system',
      content:
        "Name the topic of the user's text as 3 to 5 short tags: the subject area and the kind of text. " +
        'Reply with the tags only, in English, lowercase, separated by commas.',
    },
    { role: 'user', content: text.slice(0, MAX_TEXT) },
  ];
}

// Tidy tags: lowercase, no quotes, bullets or hashes around them, no duplicates, at most five short ones.
export function cleanTopics(list) {
  if (!Array.isArray(list)) return [];
  const tags = list
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.replace(EDGE_JUNK, '').toLowerCase())
    .filter((tag) => tag !== '' && tag.length <= MAX_TOPIC_LENGTH);
  return [...new Set(tags)].slice(0, MAX_TOPICS);
}

export function parseTopics(reply) {
  return typeof reply === 'string' ? cleanTopics(reply.split(/[,\n]/)) : [];
}
