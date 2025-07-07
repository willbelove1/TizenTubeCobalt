// webpack.config.js
const path = require('path');
const webpack = require('webpack'); // Assuming webpack is a project dependency
const TerserPlugin = require('terser-webpack-plugin'); // Assuming terser-webpack-plugin is a project dependency
const CompressionPlugin = require('compression-webpack-plugin'); // Assuming compression-webpack-plugin is a project dependency
// For CSS handling:
// const MiniCssExtractPlugin = require('mini-css-extract-plugin'); // If extracting CSS to a file

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    mode: isProduction ? 'production' : 'development',
    entry: {
      // Assuming all JS modules created are imported directly or indirectly by a main entry point.
      // If they are separate applications or need to be distinct bundles, more entry points would be needed.
      main: './src/index.js', // Placeholder: This file would import our app logic/modules
      // Example: If your main application script that uses the new modules is at the root:
      // main: './app.js', // Or whatever your main JS entry point is called
      // worker: './src/worker.js', // If there's a dedicated web worker script
    },
    output: {
      path: path.resolve(__dirname, 'dist'), // Output directory
      filename: isProduction ? '[name].[contenthash].js' : '[name].bundle.js',
      chunkFilename: isProduction ? '[name].[contenthash].chunk.js' : '[name].chunk.js',
      publicPath: '/', // Adjust if assets are served from a specific path
      clean: true // Clean the output directory before emit.
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: isProduction, // Drop console logs only in production
              drop_debugger: isProduction,
              // Consider carefully which functions are truly "pure"
              // pure_funcs: isProduction ? ['console.log', 'console.warn', 'console.info'] : [],
            },
            mangle: true, // Default is true
            output: {
              comments: false, // Remove comments in production
            },
          },
          extractComments: false, // Do not extract comments to a separate file
        }),
      ],
      splitChunks: {
        chunks: 'all', // Apply to all chunks (initial, async)
        cacheGroups: {
          vendor: { // Bundle node_modules into a vendor chunk
            test: /[\\/]node_modules[\\/](idb|hammerjs|other-npm-lib)/, // Specify key vendors or use a more general regex
            name: 'vendors',
            chunks: 'all',
            priority: -10, // Higher priority for vendor chunks
            reuseExistingChunk: true,
          },
          // Example: common modules used across multiple entry points
          // common: {
          //   name: 'common',
          //   minChunks: 2,
          //   priority: -20,
          //   reuseExistingChunk: true,
          // },
        },
      },
      // runtimeChunk: 'single', // Optional: Creates a runtime chunk to be shared for all generated chunks.
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        // Add other global constants if needed
        // 'APP_VERSION': JSON.stringify(require('./package.json').version),
      }),
      ...(isProduction ? [ // Plugins only for production
        new CompressionPlugin({
          filename: '[path][base].gz',
          algorithm: 'gzip',
          test: /\.(js|css|html|svg)$/,
          threshold: 8192, // Only assets bigger than 8KiB
          minRatio: 0.8    // Only if compression makes it 80% of original size or smaller
        }),
        // Add other production plugins here (e.g., BundleAnalyzerPlugin)
        // const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
        // new BundleAnalyzerPlugin(),
      ] : [
        // Development specific plugins (e.g., HotModuleReplacementPlugin if using webpack-dev-server)
        // new webpack.HotModuleReplacementPlugin(),
      ]),
      // If extracting CSS to a file:
      // new MiniCssExtractPlugin({
      //   filename: isProduction ? '[name].[contenthash].css' : '[name].css',
      //   chunkFilename: isProduction ? '[id].[contenthash].css' : '[id].css',
      // }),
    ],
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/, // Important: Don't transpile node_modules
          use: {
            loader: 'babel-loader', // Assuming babel-loader and presets are project dependencies
            options: {
              presets: [
                ['@babel/preset-env', {
                  // targets: "> 0.25%, not dead", // Example: specify browser targets
                  // useBuiltIns: 'usage', // Automatically adds polyfills where needed
                  // corejs: 3, // Specify core-js version if using useBuiltIns
                }]
              ],
              // plugins: ['@babel/plugin-transform-runtime'] // For helpers, reducing duplication
            }
          }
        },
        {
          test: /\.css$/,
          // For CSS, you can either bundle it into JS (style-loader) or extract to a separate file (MiniCssExtractPlugin.loader)
          // Option 1: Bundle CSS into JS (creates <style> tags)
          use: ['style-loader', 'css-loader'], // Assuming style-loader, css-loader are dependencies
          // Option 2: Extract CSS to a separate file (recommended for production)
          // use: [
          //   isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
          //   'css-loader'
          // ],
        },
        // Add loaders for other asset types if needed (images, fonts, etc.)
        // {
        //   test: /\.(png|svg|jpg|jpeg|gif)$/i,
        //   type: 'asset/resource',
        // },
        // {
        //   test: /\.(woff|woff2|eot|ttf|otf)$/i,
        //   type: 'asset/resource',
        // },
      ]
    },
    devtool: isProduction ? 'source-map' : 'eval-source-map', // 'source-map' for prod, 'eval-source-map' for dev
    // externals: { // Example if idb or hammerjs were loaded via CDN
    //   'idb': 'idb', // Expects global 'idb' variable
    //   'hammerjs': 'Hammer' // Expects global 'Hammer' variable
    // },
    resolve: {
      extensions: ['.js', '.json'], // Default extensions webpack will look for
      // alias: { // Useful for simplifying import paths
      //   '@components': path.resolve(__dirname, 'src/components/'),
      //   '@utils': path.resolve(__dirname, 'src/utils/'),
      // }
    },
    // performance: { // Optional: configure performance hints
    //   hints: isProduction ? 'warning' : false,
    //   maxAssetSize: 512000, // 500 KiB
    //   maxEntrypointSize: 512000, // 500 KiB
    // },
    // target: 'web', // Default, can be 'node', 'electron-renderer', etc.
    // stats: 'minimal', // Control verbosity of webpack output
  };
};
