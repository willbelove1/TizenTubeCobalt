// webpack.config.js
const path = require('path');
const webpack = require('webpack'); // Assuming webpack is a project dependency
const TerserPlugin = require('terser-webpack-plugin'); // Assuming terser-webpack-plugin is a project dependency
const CompressionPlugin = require('compression-webpack-plugin'); // Assuming compression-webpack-plugin is a project dependency
// For CSS handling:
const MiniCssExtractPlugin = require('mini-css-extract-plugin'); // Assuming this is a dev dependency

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  // Define a base path for our own JS modules if they are not in './src'
  // For now, assuming they are at the root or imported by an entry point in './src'
  const appSrcPath = path.resolve(__dirname); // Or path.resolve(__dirname, 'js_modules') if they are in a subfolder

  return {
    mode: isProduction ? 'production' : 'development',
    entry: {
      // All our new JS files (playlist-sync.js, voice-search.js etc.) are ES6 modules.
      // They should be imported by a main application entry point.
      // If 'src/index.js' doesn't exist or doesn't import them, Webpack won't find them.
      // For this exercise, let's assume there's an 'app.js' at the root that imports all necessary modules.
      // If your actual entry point is different, this needs to be changed.
      main: './app.js', // Assuming an app.js at root imports all our modules.
                        // Or, if they are imported by the original './src/index.js', keep that.
      // worker: './src/worker.js',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : '[name].bundle.js',
      chunkFilename: isProduction ? '[name].[contenthash].chunk.js' : '[name].chunk.js',
      publicPath: '/',
      clean: true
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: isProduction,
              drop_debugger: isProduction,
              // Keep console.error and console.warn, remove others in prod.
              pure_funcs: isProduction ? ['console.log', 'console.info', 'console.debug', 'console.trace'] : [],
            },
            mangle: true,
            output: {
              comments: false,
            },
          },
          extractComments: false,
        }),
      ],
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          // Generic vendor chunk for all node_modules
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors', // Will include idb, hammerjs, and any other npm deps
            chunks: 'all',
            priority: -10,
            reuseExistingChunk: true,
          },
          // Chunk for our own shared utilities if they grow large and are used in multiple entry points
          // appUtils: {
          //   test: (module) => {
          //     return module.resource && module.resource.startsWith(appSrcPath) &&
          //            !/[\\/]node_modules[\\/]/.test(module.resource) &&
          //            (module.resource.endsWith('error-handler.js') || module.resource.endsWith('api-utils.js'));
          //   },
          //   name: 'app-utils',
          //   chunks: 'all',
          //   priority: -5,
          //   reuseExistingChunk: true,
          // },
        },
      },
      runtimeChunk: 'single', // Good for long-term caching if multiple entry points
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
      }),
      ...(isProduction ? [
        new MiniCssExtractPlugin({ // Extract CSS into separate files for production
          filename: 'css/[name].[contenthash].css',
          chunkFilename: 'css/[id].[contenthash].css',
        }),
        new CompressionPlugin({
          filename: '[path][base].gz',
          algorithm: 'gzip',
          test: /\.(js|css|html|svg)$/,
          threshold: 8192,
          minRatio: 0.8
        }),
      ] : [
        // new webpack.HotModuleReplacementPlugin(), // If using webpack-dev-server
      ]),
    ],
    module: {
      rules: [
        {
          test: /\.js$/,
          include: appSrcPath, // Process JS files in our source directory (and its subdirectories)
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', {
                  useBuiltIns: 'usage', // Add polyfills based on usage
                  corejs: { version: 3, proposals: true }, // Specify core-js version
                  // targets: "defaults", // Or specify browser targets
                }]
              ],
              // plugins: ['@babel/plugin-transform-runtime'] // Optional for helpers
            }
          }
        },
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader', // Extract CSS in prod, inline in dev
            'css-loader' // Processes @import and url()
            // Optional: 'postcss-loader' for autoprefixing etc.
          ],
        },
      ]
    },
    devtool: isProduction ? 'source-map' : 'eval-cheap-module-source-map', // More performant devtool for dev
    resolve: {
      extensions: ['.js', '.json'],
      // alias: { // Example: If our modules were in a 'src' or 'js' folder
      //   '@modules': path.resolve(__dirname, 'src/js_modules/'),
      // }
    },
    performance: {
      hints: isProduction ? 'warning' : false,
    },
  };
};
