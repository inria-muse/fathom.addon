#!/bin/bash
REL=$1
if [ -z "$REL" ]; then 
    echo "Usage: release.sh <VERSION>"
    exit 1
fi

TAG=v$REL
echo "prepare release " $TAG " ..."

# update package.json + update.rdf
PKG=package.json
cp $PKG $PKG.save
sed 's/"version": ".*"/"version": "'$REL'"/' <$PKG.save >$PKG

# build xpi
XPI=fathom.xpi

cfx xpi --update-link https://muse.inria.fr/fathom/fathom.xpi --update-url https://muse.inria.fr/fathom/fathom.update.rdf
if [ ! -f "$XPI" ]; then
    echo "failed to build the xpi file $XPI ! aborting ..."
    mv $PKG.save $PKG
    exit 1
fi

git commit -a -m "xpi release "$TAG
git tag $TAG
git push

# keep a copy
cp $XPI dist/fathom-$REL.xpi

# web release

cp -f $XPI ../fathom.web/
cp -f fathom.update.rdf ../fathom.web/

pushd ../fathom.web
git commit -a -m "xpi release "$TAG
git push
popd

ssh apietila@muse.inria.fr 'cd fathom; git pull;'

echo 'ready'