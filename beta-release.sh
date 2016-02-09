#!/bin/bash

# make sure the version number is correct in package.json!!

echo "prepare beta-release ..."

# cleanup debug builds
rm *.xpi

# build and sign
jpm xpi
jpm sign --api-key $AMO_API_KEY --api-secret $AMO_API_SECRET --xpi $XPI

# make available online
scp ./fathom-*-an+fx.xpi apietila@muse.inria.fr:~/fathom/fathom-beta.xpi

# keep the signed version in dist
mv ./fathom-*-an+fx.xpi dist/

echo 'ready'