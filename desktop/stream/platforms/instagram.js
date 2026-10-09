const producer = require("./instagram-live-producer");

function getRtmpDestination(instagramConfig) {
  if (!instagramConfig.enabled || !instagramConfig.streamKey) return null;
  const server = (instagramConfig.rtmpUrl || "rtmps://live-upload.instagram.com:443/rtmp").replace(
    /\/$/,
    "",
  );
  return {
    platform: "instagram",
    server,
    key: instagramConfig.streamKey,
    url: `${server}/${instagramConfig.streamKey}`,
    note: "Clé Live Producer (régénérée à chaque live)",
  };
}

/**
 * Ouvre Live Producer, applique le titre, récupère URL+clé dynamiques.
 */
async function prepareAndGetCredentials(title, options = {}) {
  return producer.prepareLive(title, options);
}

async function goLive() {
  return producer.goLive();
}

module.exports = {
  getRtmpDestination,
  prepareAndGetCredentials,
  goLive,
  openProducer: () => producer.openProducer(),
  getProducerStatus: () => producer.getStatus(),
};
