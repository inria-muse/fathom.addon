#!/bin/bash
REL=$1
if [ -z "$REL" ]; then 
    echo "Usage: release.sh <VERSION>"
    exit 1
fi

TAG=v$REL
echo "prepare release " $TAG " ..."

# do not release from this branch
echo "you should be in the master branch for release! aborting"
exit 1

# update package.json + update.rdf
cp package.json package.json.save
sed 's/"version": ".*"/"version": "'$REL'"/' <package.json.save >package.json

# build xpi
XPI=fathom.xpi

cfx xpi --update-link https://muse.inria.fr/fathom/fathom.xpi --update-url https://muse.inria.fr/fathom/fathom.update.rdf
if [ ! -f "$XPI" ]; then
    echo "failed to build the xpi file $XPI ! aborting ..."
    mv package.json.save package.json
    exit 1
fi

git commit -a -m "xpi release "$TAG
git tag $TAG
git push

# keep a copy
cp $XPI dist/fathom-$TAG.xpi

# web release

cp -f $XPI ../fathom.web/
cp -f fathom.update.rdf ../fathom.web/

pushd ../fathom.web
git commit -a -m "xpi release "$TAG
git push
popd

ssh apietila@muse.inria.fr 'cd fathom; git pull;'

echo 'ready'