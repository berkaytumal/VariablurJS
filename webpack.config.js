const path = require('path');
module.exports = {
  entry: './src/variablur.js',
  output: {
    filename: 'variablur.js',
    path: path.resolve(__dirname, 'dist'),
    library: 'variablur',
    libraryTarget: 'umd',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                useBuiltIns: 'usage',
                corejs: 3
              }]
            ]
          }
        }
      }
    ]
  }
};