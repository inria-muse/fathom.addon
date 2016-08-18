#!/bin/bash
REL=$1
if [ -z "$REL" ]; then
    echo "Usage: release.sh <VERSION>"
    exit 1
fi

TAG=v$REL
echo "prepare release " $TAG " ..."
echo $AMO_API_KEY

mkdir dist

# update package.json + update.rdf
PKG=package.json
cp $PKG $PKG.save
sed 's/"version": ".*"/"version": "'$REL'"/' <$PKG.save >$PKG

RDF=fathom.update.rdf
cp $RDF $RDF.save
sed 's/<em:version>.*<\/em:version>/<em:version>'$REL'<\/em:version>/' <$RDF.save >$RDF

# cleanup debug builds
rm *.xpi
rm install.rdf
rm bootstrap.js

# build xpi
jpm xpi

# NOTE: the out xpi name keeps changeing depending on jpm version ...
#XPI=jid1-o49GgyEaRRmXPA@jetpack-$REL.xpi
XPI=fathom.xpi

if [ ! -f "$XPI" ]; then
    echo "failed to build the xpi file $XPI ! aborting ..."
    mv $PKG.save $PKG
    mv $RDF.save $RDF
    exit 1
fi

# sign the xpi
jpm sign --api-key $AMO_API_KEY --api-secret $AMO_API_SECRET --xpi $XPI

# the signed xpi name keeps changeing too ...
SIGNED=fathom-$REL-fx+an.xpi
if [ ! -f "$SIGNED" ]; then
    SIGNED=fathom-$REL-an+fx.xpi
fi

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

echo "new release available at dist/fathom-$REL.xpi"
