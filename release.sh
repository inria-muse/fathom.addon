#!/bin/bash
REL=$1
if [ -z "$REL" ]; then
    echo "Usage: release.sh <VERSION>"
    exit 1
fi

AMO_API_KEY=user:11854584:781
AMO_API_SECRET=9df7245ac238599f17f397c7af1e6601543cccc9d68c454f36a843a2b12ff3d9

TAG=v$REL
echo "prepare release " $TAG " ..."

# update package.json + update.rdf
PKG=package.json
cp $PKG $PKG.save
sed 's/"version": ".*"/"version": "'$REL'"/' <$PKG.save >$PKG

RDF=fathom.update.rdf
cp $RDF $RDF.save
sed 's/<em:version>.*<\/em:version>/<em:version>'$REL'<\/em:version>/' <$RDF.save >$RDF

# cleanup debug builds
#rm *.xpi

# build xpi
XPI=jid1-o49GgyEaRRmXPA@jetpack-$REL.xpi

#jpm xpi

if [ ! -f "$XPI" ]; then
    echo "failed to build the xpi file $XPI ! aborting ..."
    mv $PKG.save $PKG
    mv $RDF.save $RDF
    exit 1
fi

# sign the xpi
SIGNED=fathom-$REL-fx+an.xpi

#jpm sign --api-key $AMO_API_KEY --api-secret $AMO_API_SECRET --xpi $XPI

if [ ! -f "$SIGNED" ]; then
    echo "failed to sign the xpi file $XPI ! $SIGNED not found ..."
    mv $PKG.save $PKG
    mv $RDF.save $RDF
    exit 1
fi

# keep the signed version in dist
mv $SIGNED dist/fathom-$REL.xpi

# all good, commit and tag to git
git commit -a -m "xpi release "$TAG
git tag $TAG
git push

# web release
cp -f dist/fathom-$REL.xpi ../fathom.web/fathom.xpi
cp -f $RDF ../fathom.web/

pushd ../fathom.web
git commit -a -m "xpi release "$TAG
git push
popd

ssh apietila@muse.inria.fr 'cd fathom; git pull;'

echo 'ready'
