// Local Android sideload builds: skip native shiki (host libonig.so is x86_64).
module.exports = {
  dependencies: {
    "react-native-shiki-engine": {
      platforms: {
        android: null,
      },
    },
  },
};
